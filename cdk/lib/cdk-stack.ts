import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

const DOMAIN = 's3.hylandee.com';
const CERT_ARN =
  'arn:aws:acm:us-east-1:320326036945:certificate/b9b2c3fc-c987-4237-9e29-f36b8a6a2ba1';

export class HylandeeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── Static site ────────────────────────────────────────────────────────

    const bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: 'hylandee-static-site',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', CERT_ARN);

    // S3 REST endpoint doesn't serve directory index files automatically,
    // so we rewrite /foo/ → /foo/index.html at the edge.
    const indexRewriteFn = new cloudfront.Function(this, 'IndexRewriteFn', {
      code: cloudfront.FunctionCode.fromInline(
        `function handler(event) {
  var uri = event.request.uri;
  if (uri.endsWith('/')) {
    event.request.uri += 'index.html';
  } else if (!uri.includes('.')) {
    event.request.uri += '/index.html';
  }
  return event.request;
}`,
      ),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // ── Smolt API ──────────────────────────────────────────────────────────

    const table = new dynamodb.Table(this, 'SmoltTable', {
      tableName: 'smolt',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const sessionSecret = new secretsmanager.Secret(this, 'SessionSecret', {
      secretName: 'smolt/session-secret',
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
    });

    // Shared header secret prevents direct Lambda URL access that bypasses CloudFront.
    // Set once in cdk.json context: { "context": { "originSecret": "<uuid>" } }
    // or via: cdk deploy --context originSecret=<uuid>
    const originSecret = this.node.tryGetContext('originSecret') as string | undefined;
    if (!originSecret) {
      throw new Error('Set originSecret in CDK context: cdk deploy --context originSecret=<uuid>');
    }

    const smoltFn = new NodejsFunction(this, 'SmoltFn', {
      entry: path.join(__dirname, '../../smolt-lambda/index.ts'),
      depsLockFilePath: path.join(__dirname, '../../smolt-lambda/package-lock.json'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
      environment: {
        TABLE_NAME: table.tableName,
        SESSION_SECRET_ARN: sessionSecret.secretArn,
        ORIGIN_SECRET: originSecret,
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      reservedConcurrentExecutions: 2,
    });

    table.grantReadWriteData(smoltFn);
    sessionSecret.grantRead(smoltFn);

    const fnUrl = smoltFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // Extract hostname from Function URL: "https://abc.lambda-url.region.on.aws/" → "abc.lambda-url.region.on.aws"
    const lambdaHostname = cdk.Fn.select(2, cdk.Fn.split('/', fnUrl.url));

    const apiOrigin = new origins.HttpOrigin(lambdaHostname, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      customHeaders: { 'x-origin-secret': originSecret },
    });

    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(
      this,
      'ApiOriginRequestPolicy',
      {
        cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
        headerBehavior: cloudfront.OriginRequestHeaderBehavior.none(),
        queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      },
    );

    // ── CloudFront ─────────────────────────────────────────────────────────

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          {
            function: indexRewriteFn,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: apiOriginRequestPolicy,
        },
      },
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      domainNames: [DOMAIN],
      certificate,
    });

    new s3deploy.BucketDeployment(this, 'Deployment', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../..'), {
          exclude: [
            '.git',
            '.git/**',
            '.DS_Store',
            '**/.DS_Store',
            'node_modules',
            'node_modules/**',
            'cdk',
            'cdk/**',
            'smolt-lambda',
            'smolt-lambda/**',
            'package.json',
            'package-lock.json',
            'server.js',
            'CLAUDE.md',
            'README.md',
            '.gitignore',
            'auth',
            'auth/**',
          ],
        }),
      ],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'CloudFrontURL', { value: `https://${DOMAIN}` });
    new cdk.CfnOutput(this, 'SmoltFnUrl', { value: fnUrl.url });
  }
}
