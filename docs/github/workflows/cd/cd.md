# CD Workflows

All CD workflows are triggered via `repository_dispatch` events from CI after successful builds.

| Workflow | Trigger Event | Purpose |
|----------|---------------|---------|
| [`cd-aws.yml`](../../../../.github/workflows/cd-aws.yml) | `deploy-aws` | Deploy Website/API Docker images to AWS ECR → ECS |
| [`cd-bulletin.yml`](../../../../.github/workflows/cd-bulletin.yml) | `deploy-bulletin` | Deploy Bulletin Lambda ZIP to AWS Lambda |
| [`cd-app.yml`](../../../../.github/workflows/cd-app.yml) | `deploy-app` | Deploy mobile/desktop app to Google Play & Microsoft Store |
| [`cd-data.yml`](../../../../.github/workflows/cd-data.yml) | `deploy-data` | Deploy data updates to production database |

## AWS Deployment (`cd-aws.yml`)

Triggered by `shared-release.yml` after Website or API release.

**Flow:**
1. Restore Docker image artifact from CI run
2. Push to AWS ECR with version tag + `latest`
3. ECS auto-deploys via EventBridge (watches `latest` tag)

**Deployment resilience:** With a single ECS task (`DesiredCount: 1`), rolling updates may briefly interrupt traffic. If zero-downtime deployments become necessary, consider running the service with **at least 2 tasks** so one stays up while the other is replaced. See [Deployment incident analysis 2026-02-10](../../../aws/deployment-downtime-2026-02-10.md) for background and options.

## Bulletin Deployment (`cd-bulletin.yml`)

Triggered by `shared-release.yml` after Bulletin release.

**Flow:**
1. Download the pre-built Lambda ZIP artifact from CI
2. Configure AWS credentials (OIDC)
3. Deploy ZIP to Lambda function `bible-on-site-bulletin` via `aws lambda update-function-code`

**Notes:**
- The bulletin Lambda is a Rust binary compiled for `aarch64-unknown-linux-musl` (ARM64)
- Lambda Function URLs are not available in `il-central-1`; the website invokes the Lambda directly via AWS SDK

## App Deployment (`cd-app.yml`)

Triggered by `release_app` job in `ci.yml` after App CI passes.

**Platforms:**

| Platform | Store | Artifact | Track |
|----------|-------|----------|-------|
| Android | Google Play | `.aab` | Internal |
| Windows | Microsoft Store | `.msix` | Flight |

## Data Deployment (`cd-data.yml`)

Triggered by `release_data` job in `ci.yml` after Data CI passes.

**Flow:**
1. Configure AWS credentials (OIDC)
2. Run data migration scripts against production RDS

## Architecture
![cd](./cd.svg)