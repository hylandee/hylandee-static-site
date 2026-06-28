# hylandee CDK — S3 + CloudFront

Provisions an S3 bucket (`hylandee-static-site`) and CloudFront distribution, and syncs the repo's static files into the bucket on every deploy.

**Live URL:** https://d32q8v5tpchitc.cloudfront.net

## Syncing the site after changes

After pushing new content to main, run from this directory:

```bash
npm run deploy
```

This uploads changed files to S3 and automatically invalidates the CloudFront cache (`/*`). Changes are live within ~30 seconds of the deploy completing.

First deploy takes ~5 min (CloudFront distribution creation). Subsequent deploys with only file changes take ~1–2 min.

## Other commands

```bash
npm run diff    # preview what would change before deploying
npm run synth   # emit the CloudFormation template (dry run)
npm run build   # format (prettier) + type-check (tsc)
```

## What gets synced

Everything in the repo root **except**:
- `node_modules/`, `cdk/`, `package*.json`, `server.js` — dev tooling
- `CLAUDE.md`, `README.md`, `.gitignore` — not web assets
- `auth/` — depends on the Rust backend, not served from S3

## Infrastructure

- **S3**: private bucket, accessed via CloudFront OAC (Origin Access Control)
- **CloudFront**: HTTPS-only, US/EU edge locations (`PriceClass_100`), CloudFront Function rewrites `/foo/` → `/foo/index.html`
- **Region**: us-east-1
