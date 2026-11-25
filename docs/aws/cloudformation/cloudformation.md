# AWS CloudFormation Templates

This directory includes templates for deployed stacks, reference templates for
manually managed resources, and rollout proposals. Use each deployed stack's
runbook and check live resource ownership before applying an update.
Reference templates document existing resources or proposed designs and
must not be deployed as-is.

## Architecture Overview

The [AWS architecture guide](../architecture/aws-architecture.md) describes
the production request paths, services, and rollout ownership.

## Sensitive Information

Sensitive values are masked with placeholders. To retrieve actual values:

| Placeholder | How to Retrieve |
|-------------|-----------------|
| `<AWS_ACCOUNT_ID>` | `aws sts get-caller-identity --query Account --output text` |
| `<SSO_INSTANCE_ARN>` | `aws sso-admin list-instances --query "Instances[0].InstanceArn" --output text --region il-central-1` |
| `<IDENTITY_STORE_ID>` | `aws sso-admin list-instances --query "Instances[0].IdentityStoreId" --output text --region il-central-1` |
| `<EC2_PUBLIC_IP>` | `aws ec2 describe-instances --instance-ids i-0d811651c11294634 --query "Reservations[0].Instances[0].PublicIpAddress" --output text --region il-central-1` |
| `<KEY_PAIR_FINGERPRINT>` | `aws ec2 describe-key-pairs --key-names nginx --query "KeyPairs[0].KeyFingerprint" --output text --region il-central-1` |

## Lambda Python Runtimes

The `bible-on-site-db-populator` Lambda targets `python3.15` (Amazon Linux
2023). The `ecr-to-ecs-deploy` Lambda remains on `python3.14` (deprecation
scheduled for 2029-06-30). The data deployment rehearsal in
`ci-data-deploy.yml` uses Python 3.15 to match the db-populator runtime.

The live functions are created outside CloudFormation. After explicit approval
of the AWS change, upgrade each one in `il-central-1` to its target runtime
(`python3.15` for `bible-on-site-db-populator`, `python3.14` for
`ecr-to-ecs-deploy` until its own rollout), recording the previous runtime for
rollback:

```bash
aws lambda get-function-configuration --function-name <NAME> --query Runtime --region il-central-1
aws lambda update-function-configuration --function-name <NAME> --runtime <RUNTIME> --region il-central-1
aws lambda wait function-updated --function-name <NAME> --region il-central-1
```

Verify with the next data CD (`bible-on-site-db-populator`) or ECR push
(`ecr-to-ecs-deploy`) and the function's CloudWatch logs. Roll back by running
`update-function-configuration` with the recorded runtime.

## Templates

### 1. `vpc-networking.yaml`
VPC configuration, subnets, and security groups.

- **VPC**: Default VPC (`172.31.0.0/16`)
- **Subnets**: 3 public subnets across AZs
- **Security Groups**: nginx (public) and ECS (VPC-only)

### 2. `ecr-repositories.yaml`
Reference layout for the ECR repositories. For current tag mutability,
rollout ownership, and rollback retention, see the
[AWS architecture guide](../architecture/aws-architecture.md#release-and-monitoring)
and the [admin ECR policy](../admin-arm64-migration.md#ecr-policy).

### 3. `ecs-services.yaml`
Reference for the ECS cluster, task definitions, services, and Cloud Map.

**Components:**
- ECS Cluster: `bible-on-site-cluster` (Fargate)
- Cloud Map Namespace: `bible-on-site.local` (private DNS)
- Website service at `website.bible-on-site.local:3000`
- API service at `api.bible-on-site.local:3003`
- Admin service at `admin.bible-on-site.local:3101`
- Task Execution Role: `ecsTaskExecutionRole`
- Website Task Role: `bible-on-site-website-task-role` (allows `lambda:InvokeFunction` on bulletin Lambda)

**Prerequisites — SecureString SSM parameters:**

ECS injects task `Secrets:` from SSM Parameter Store at container start, so
every referenced parameter must already exist or the task fails to start.
CloudFormation cannot create `SecureString` parameters — create them once per
account/region (the same manual mechanism as `bible-on-site-tanah-db-url`):

```bash
# Shared admin <-> website revalidation credential (POST /api/revalidate)
aws ssm put-parameter --name bible-on-site-revalidate-secret \
  --type SecureString --value "$(openssl rand -hex 32)" \
  --region il-central-1
```

### 4. `ec2-nginx.yaml`
EC2 instance running nginx as reverse proxy.

**Features:**
- SSL termination (Let's Encrypt)
- Routes website, API, and admin traffic to ECS via Cloud Map DNS
- VPC DNS resolver (`172.31.0.2`) for service discovery

Replacement sizing/architecture (t4g Graviton candidates, validation harness,
staged DNS canary and EIP cutover) is analyzed in
[../router-replacement-validation.md](../router-replacement-validation.md) —
issue #2561.

> **Note**: Key pair and SSL certificates must be set up manually.

### 5. `github-oidc.yaml`
Reference for the GitHub Actions OIDC provider and deployment role.

### 6. `iam-identity-center.yaml`
IAM Identity Center (SSO) configuration including permission sets.

> **Note**: IAM Identity Center resources are **not fully supported** by CloudFormation. This template documents the configuration but resources must be created via Console or CLI.

### 7. `ecr-ecs-auto-deploy.yaml`
Reference for the EventBridge rules and the `ecr-to-ecs-deploy` Lambda
(Python 3.14). In production, successful website and admin `latest` pushes
invoke the Lambda, which forces a new ECS deployment with the current task
definition. The API rule is disabled while GitHub Actions owns the protected
API handover. [Deployed Lambda details](./ecr-ecs-auto-deploy/README.md) ·
[API rollout ownership](../api-arm64-cutover.md#one-api-deployment-owner)

### 8. `cloudwatch.yaml`
Reference for a website log group and CPU target tracking. The
[AWS architecture guide](../architecture/aws-architecture.md#release-and-monitoring)
describes live log retention and scaling targets.

### 9. `route53.yaml`
Route53 hosted zones and DNS records.

**Hosted Zones:**
- `xn--febl3a.com` (תנך.com) - Public zone
- `xn--febl3a.co.il` (תנך.co.il) - Public zone
- `bible-on-site.local` - Private zone (managed by Cloud Map)

**DNS Records (per public zone):**
- `A` record → `<EC2_PUBLIC_IP>` (EC2 Nginx)
- `CNAME` wildcard (`*.domain`) → apex domain
- `CNAME` www → apex domain

**Flow:** User → Route53 DNS → Nginx EC2 → ECS via Cloud Map

### 10. `master-stack.yaml`
Nested stack that deploys all components together (for reference).

### 11. `rds-mysql.yaml`
Reference configuration for a new RDS MySQL instance. The template defaults to
MySQL 9.7.4. See the [MySQL 9.7 upgrade runbook](../mysql-97-upgrade.md) for the
existing production instance.

**Components:**
- DB Subnet Group: `tanah-db-subnet-group` (spans 3 AZs)
- Security Group: `tanah-rds-sg` (allows MySQL from ECS)
- RDS Instance: `tanah-mysql` (db.t3.micro, 20GB gp3)
- SSM Parameters: Database connection info (username, dbname, host, port)

**Features:**
- Encrypted storage (AWS-managed KMS key)
- 7-day backup retention
- Public addressing for authorized GitHub Actions access with security-group restricted ingress
- Password stored in SSM Parameter Store (SecureString)

**Retrieve Connection Info:**
```bash
# Get endpoint
aws rds describe-db-instances --db-instance-identifier tanah-mysql \
  --query "DBInstances[0].Endpoint" --region il-central-1

# Get password from SSM
aws ssm get-parameter --name bible-on-site-tanah-db-password \
  --with-decryption --query "Parameter.Value" --output text --region il-central-1
```

### 12. `bulletin-lambda/bulletin-lambda.yaml`
Bulletin PDF Generator Lambda function.

**Components:**
- Lambda Function: `bible-on-site-bulletin` (Rust, `provided.al2023`)
- IAM Role: `bible-on-site-bulletin-role` (CloudWatch logs)
- CloudWatch Log Group: `/aws/lambda/bible-on-site-bulletin`

**Notes:**
- The website and admin invoke this Lambda directly via the AWS SDK.
- Deployed via ZIP package containing the `bootstrap` Rust binary.

### 13. `data-deploy/data-deploy.yaml`
Lambda function for deploying SQL data to RDS MySQL.

**Components:**
- S3 Bucket: `bible-on-site-data-deploy` (SQL file staging)
- Lambda Function: `bible-on-site-db-populator` (Python 3.15)
- Security Group: `data-deploy-lambda-sg` (VPC access)
- IAM Role: `DataDeployLambdaRole` (SSM read, S3 read)

**Features:**
- Runs in VPC (can access RDS)
- Gets DB credentials from SSM Parameter Store
- Downloads SQL files from S3
- Executes SQL statements against RDS
- Invoked by GitHub Actions CD workflow

**Flow:** GitHub Actions → S3 (upload SQL) → Lambda invoke → RDS MySQL

### 14. `cloudfront-edge-candidate.yaml`
Isolated CloudFront distribution in front of the nginx router for edge-rollout
validation (issue [#2508](https://github.com/bible-on-site/bible-on-site/issues/2508)).

**Components:**
- CloudFront distribution on the default `*.cloudfront.net` certificate — no
  aliases, so no DNS/ACM change is needed to validate
- `Managed-CachingDisabled` cache policy + `Managed-AllViewerExceptHostHeader`
  origin request policy (pass-through to the canonical nginx vhost)
- No access-log bucket: nginx logs cover forwarded origin requests and
  CloudWatch standard metrics cover edge request/byte/error totals

> **Note**: Validation-only candidate. See
> [edge-rollout-validation.md](../edge-rollout-validation.md) for the full
> plan, staged migration and rollback. No production routing is changed.
> The candidate hostname is public. The live DNS and cost findings in
> [edge-research-2026-10-27.md](../edge-research-2026-10-27.md) are preconditions
> for any later rollout, including explicit API/admin DNS isolation.

### Asset-only CDN: `cloudfront-assets.yaml`

Reference template for the additive CloudFront endpoint in front of the public
assets bucket. The production distribution was provisioned separately. The
reference uses the public S3 origin, disables caching, and sets error TTLs to
zero. Its custom origin policy forwards CORS inputs and query parameters.
See the [S3 bill reassessment and approval-gated runbook](../s3-delivery-cost-2026-11-01.md)
for costs, compatibility checks, CLI request generation and rollback. Never
deploy this reference file as a CloudFormation stack.

### Cost-monitoring proposal: `cost-monitoring.yaml`

Reference-only proposal for the cost-alerting gap recorded in
[s3-delivery-cost-2026-11-01.md](../s3-delivery-cost-2026-11-01.md): a monthly
AWS Budget (forecast/actual email alerts), a per-service Cost Explorer anomaly
monitor with a daily subscription, and an `EstimatedCharges` billing alarm on a
template-local us-east-1 SNS topic. Applying it creates real resources and is a
gated #2576 change; see [cost-observability.md](../cost-observability.md) and
the template's own `Metadata.Documentation` for prerequisites, thresholds and
rollback. The recurring read-only baseline check lives in
`devops/cost-audit.mjs`. Never deploy this reference file as a CloudFormation
stack.

## Current Infrastructure State

See the [AWS architecture guide](../architecture/aws-architecture.md) for the
production inventory and request and deployment paths.

## Importing Existing Resources

Importing a live resource requires an approved import plan based on its
current configuration and CloudFormation ownership. Prepare and validate a
dedicated import template for that plan.

## Deployment Cheat Sheet

**1. Login to SSO**
```bash
aws sso login --profile bible-on-site-deployer
```

## Related Documentation

- [nginx Configuration](./ec2-nginx/router/router.conf)
- [Edge rollout validation plan](../edge-rollout-validation.md)
