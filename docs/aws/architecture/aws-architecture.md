# AWS architecture

Bible On Site runs in AWS Israel (`il-central-1`). The website, mobile API,
and admin console share an EC2 nginx router and an ECS Fargate cluster.

![Production request and asset paths. Browsers and apps reach the website, API, and admin through nginx. Cloud Map supplies private task addresses. The services use RDS, the website and admin invoke the bulletin Lambda, and admin serves the private S3 archive. CI builds can fetch public S3 assets through CloudFront.](./architecture.svg)

[Editable diagrams.net source](./architecture.drawio)

## Public ingress and ECS

Route 53 hosts `xn--febl3a.co.il` and `xn--febl3a.com`. Both apex records point
to the same Elastic IP on a single `t3.small` EC2 instance. Wildcard CNAMEs
resolve the `api.` and `admin.` hosts to the corresponding apex. The `www` hosts
redirect to their respective apex. nginx terminates HTTPS and selects an
upstream by hostname. It uses the VPC resolver to look up private ECS task
addresses in the Cloud Map namespace `bible-on-site.local` and proxies directly
to the tasks. Public application traffic takes this route without an AWS load
balancer or a site-wide CloudFront distribution.

| Public host on either domain | ECS service | Private upstream | Capacity |
| --- | --- | --- | --- |
| Apex | `bible-on-site-website` (Next.js) | `website.bible-on-site.local:3000` | ARM64 Fargate, 0.5 vCPU, 2 GiB |
| `api.` | `bible-on-site-api` (GraphQL, including mobile clients) | `api.bible-on-site.local:3003` | ARM64 Fargate, 0.25 vCPU, 512 MiB |
| `admin.` | `bible-on-site-admin` | `admin.bible-on-site.local:3101` | ARM64 Fargate Spot, 0.25 vCPU, 512 MiB |

The cluster is `bible-on-site-cluster`. The website scales from one to three
tasks with targets of 70% CPU and 80% memory. The API and admin each have one
desired task. Admin console sign-in uses Amazon Cognito federated with AWS IAM
Identity Center. The private archive has a separate Cognito pool for archivers
and serves files through the admin service from a private S3 bucket.
[nginx routing](../cloudformation/ec2-nginx/router/router.conf) ·
[Private archive](../private-archive.md)

## Database and bulletin delivery

- **Application database.** The ECS services use `tanah-mysql`, a single-AZ
  RDS MySQL 8.4 instance with encrypted gp3 storage and seven-day automated
  backups. The RDS endpoint has public addressing enabled. MySQL access is
  controlled by security groups, with temporary runner-specific `/32` rules for
  authorized GitHub Actions builds and backup jobs. The backup workflow exports
  weekly and monthly copies, verifies them by restoring to a scratch database,
  and stores them in a private S3 bucket with Object Lock.
  [Backup and restore runbook](../database-backups.md)
- **Bulletin rendering.** The website invokes `bible-on-site-bulletin` through
  the AWS SDK for on-demand PDFs. The admin worker invokes the same function
  for daily bulletin PDFs and email HTML. The Rust function runs as a ZIP on
  `provided.al2023` and uses bundled scripture and content from RDS over the
  VPC.
  [Bulletin Lambda reference](../cloudformation/bulletin-lambda/bulletin-lambda.yaml)
- **Daily bulletin.** EventBridge Scheduler enqueues a trigger in SQS at 10:00
  Jerusalem time, Sunday through Thursday. The admin worker uses the study
  calendar to prepare the PDF and email HTML and queue delivery jobs for
  Amazon SES, Telegram, and WhatsApp. SQS redrives exhausted messages to a
  dead-letter queue. Channel audiences and subscriber consent govern sends.
  [Daily bulletin schedule](../daily-bulletin-schedule.md)
- **Data deployment.** GitHub Actions stages SQL in `bible-on-site-data-deploy`
  and invokes the Python 3.14 `bible-on-site-db-populator` Lambda to apply it
  to RDS. Database connection secrets are held in SSM Parameter Store.
  [Data deployment runbook](../../../devops/deploy/README.md#2-data-deployment-database-population)

## Public assets

`bible-on-site-assets` in S3 is the origin for public assets, including
recordings and images. Existing S3 URLs continue to serve browsers and
installed clients. GitHub Actions uses the asset-only CloudFront origin
`dpcnux643agl3.cloudfront.net` for build-time recitation downloads via
`ASSETS_BASE_URL`. The distribution has caching disabled and no website
aliases. Website and admin builds have a separate `BROWSER_ASSETS_BASE_URL`
switch, which is unset.
[Asset delivery and compatibility](../s3-delivery-cost-2026-11-01.md) ·
[Browser rollout switch](../assets-cdn-browser-rollout-2026-11-17.md)

## Release and monitoring

GitHub Actions assumes AWS deployment roles using OIDC and publishes versioned
images and `latest` to ECR. Each `latest` points to an OCI image index for
amd64 and ARM64. Version tags are immutable. The website and admin lifecycle
policies protect their newest tagged x86 rollback images. The API repository
has no ECR lifecycle policy.

| Service | ECR repository | ECS rollout owner |
| --- | --- | --- |
| Website | `bible-on-site` | A successful ECR `latest` push triggers EventBridge and the `ecr-to-ecs-deploy` Lambda. |
| Admin | `bible-on-site-admin` | Its own EventBridge rule invokes the same Lambda on a successful `latest` push. |
| API | `bible-on-site-api` | The GitHub Actions deployer owns the protected ECS and Cloud Map handover. The API EventBridge rule is disabled. |

The EventBridge Lambda runs Python 3.14 and forces a new deployment while
retaining the current task definition. The website warms its readiness
endpoint before admission and drains outgoing tasks while nginx may still
hold their DNS addresses. CloudWatch retains website logs for 180 days and
API and admin logs for 365 days.
[AWS release workflow](../../../.github/workflows/cd-aws.yml) ·
[API handover](../api-arm64-cutover.md#one-api-deployment-owner) ·
[Website readiness and drain](../website-handover-latency.md)

The [CloudFormation catalog](../cloudformation/cloudformation.md) includes
reference templates, stacks with dedicated deployment procedures, and rollout
proposals. Use the live configuration when checking production state.
