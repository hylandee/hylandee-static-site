import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import * as path from 'path';

const DOMAIN = 's3.hylandee.com';
// DNS is managed in Linode, not Route 53. Cert was issued manually via ACM DNS validation.
const CERT_ARN =
  'arn:aws:acm:us-east-1:320326036945:certificate/b9b2c3fc-c987-4237-9e29-f36b8a6a2ba1';

export class HylandeeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

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

    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${DOMAIN}`,
    });
  }
}
