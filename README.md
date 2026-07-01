# hylandee static site

Personal site hosted at [s3.hylandee.com](https://s3.hylandee.com) via CloudFront + S3. Vanilla HTML/CSS/JS, no build step, no framework.

## Pages

| Path | Description |
|---|---|
| `/` | Home — links to all pages |
| `/japan` | Japan travel tips |
| `/quiz` | Animal personality quiz |
| `/necrouomicon` | UoM rants |
| `/workout` | SL5×5 tracker (pure static, localStorage) |
| `/lifts-on-lambda` | SL5×5 tracker backed by Lambda + DynamoDB |

## Dev server

```bash
npm install
node server.js
# → http://localhost:3002
```

Serves static files and proxies `/api/*` to the Rust backend at `http://127.0.0.1:3000` (only needed for the `auth/` pages).

## Lifts on Lambda (`/lifts-on-lambda`)

SL5×5 workout tracker with a real backend. Single-file SPA (`lifts-on-lambda/index.html`) backed by:

- **Lambda** (`smolt-lambda/`) — TypeScript function handling auth, session management, workout progression, and backups
- **DynamoDB** — single table (`smolt`) storing users, sessions, progress, and rate-limit counters
- **CloudFront** — routes `/api/*` to the Lambda Function URL; enforces origin secret header to prevent direct access

Features: plate calculator, warmup sets, rest timer, weight history charts, backup/restore, session notes, deload controls.

## Deploy

```bash
cd cdk
npm run deploy -- --context originSecret=<secret>
```

Deploys the full stack: S3 bucket, CloudFront distribution, Lambda function, DynamoDB table.

The Lambda is capped at 2 reserved concurrent executions. Login and registration are rate-limited per IP (10 and 5 attempts/minute respectively) using DynamoDB TTL counters.

## Adding a new page

Create a new directory with a self-contained `index.html` (inline styles and scripts). Add a link in the root `index.html`. No build step required.
