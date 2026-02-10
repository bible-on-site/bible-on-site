# AWS CloudFormation Templates

This directory contains CloudFormation templates that document the AWS infrastructure for the Bible On Site project.

> **⚠️ IMPORTANT DISCLAIMER**
>
> **These templates have NEVER been tested or deployed.** They are maintained purely as **Infrastructure as Code documentation** to reflect the de-facto AWS configuration that was created manually or via CLI.
>
> While these templates are updated regularly to document infrastructure changes, they should NOT be assumed to work without thorough testing. Use them as reference documentation only.

## Architecture Overview

For a detailed visual representation of the infrastructure, please refer to the [Architecture Documentation](../architecture/aws-architecture.md).

The system consists of an Nginx reverse proxy on EC2 routing traffic to ECS Fargate containers, using Cloud Map for service discovery.


## Sensitive Information

Sensitive values are masked with placeholders. To retrieve actual values:

| Placeholder | How to Retrieve |
|-------------|-----------------|
| `<AWS_ACCOUNT_ID>` | `aws sts get-caller-identity --query Account --output text` |
| `<SSO_INSTANCE_ARN>` | `aws sso-admin list-instances --query "Instances[0].InstanceArn" --output text --region il-central-1` |
| `<IDENTITY_STORE_ID>` | `aws sso-admin list-instances --query "Instances[0].IdentityStoreId" --output text --region il-central-1` |
| `<EC2_PUBLIC_IP>` | `aws ec2 describe-instances --instance-ids i-0d811651c11294634 --query "Reservations[0].Instances[0].PublicIpAddress" --output text --region il-central-1` |
| `<KEY_PAIR_FINGERPRINT>` | `aws ec2 describe-key-pairs --key-names nginx --query "KeyPairs[0].KeyFingerprint" --output text --region il-central-1` |

## Templates

### 1. `vpc-networking.yaml`
VPC configuration, subnets, and security groups.

- **VPC**: Default VPC (`172.31.0.0/16`)
- **Subnets**: 3 public subnets across AZs
- **Security Groups**: nginx (public) and ECS (VPC-only)

### 2. `ecr-repositories.yaml`
ECR repositories for container images.

**Deploy:**
```bash
aws cloudformation deploy \
  --template-file ecr-repositories.yaml \
  --stack-name bible-on-site-ecr \
  --region il-central-1 \
  --profile AdministratorAccess-<AWS_ACCOUNT_ID>
```

### 3. `ecs-services.yaml`
ECS cluster, task definitions, services, and Cloud Map service discovery.

**Components:**
- ECS Cluster: `bible-on-site-cluster` (Fargate)
- Cloud Map Namespace: `bible-on-site.local` (private DNS)
- Service: `bible-on-site-website` → `website.bible-on-site.local:3000`
- Task Execution Role: `ecsTaskExecutionRole`

**Deploy:**
```bash
aws cloudformation deploy \
  --template-file ecs-services.yaml \
  --stack-name bible-on-site-ecs \
  --capabilities CAPABILITY_NAMED_IAM \
  --region il-central-1 \
  --profile AdministratorAccess-<AWS_ACCOUNT_ID>
```

### 4. `ec2-nginx.yaml`
EC2 instance running nginx as reverse proxy.

**Features:**
- SSL termination (Let's Encrypt)
- Routes to ECS via Cloud Map DNS (`website.bible-on-site.local`)
- VPC DNS resolver (`172.31.0.2`) for service discovery

> **Note**: Key pair and SSL certificates must be set up manually.

### 5. `github-oidc.yaml`
GitHub Actions OIDC provider and IAM role for CI/CD deployments.

**Deploy:**
```bash
aws cloudformation deploy \
  --template-file github-oidc.yaml \
  --stack-name bible-on-site-github-oidc \
  --capabilities CAPABILITY_NAMED_IAM \
  --region il-central-1 \
  --profile AdministratorAccess-<AWS_ACCOUNT_ID>
```

### 6. `iam-identity-center.yaml`
IAM Identity Center (SSO) configuration including permission sets.

> **Note**: IAM Identity Center resources are **not fully supported** by CloudFormation. This template documents the configuration but resources must be created via Console or CLI.

### 7. `ecr-ecs-auto-deploy.yaml`
Automatic ECS deployment when ECR images are pushed.

**Components:**
- EventBridge Rules: Listen for ECR push events (tag: `latest`)
  - `ecr-push-bible-on-site-website` → triggers on `bible-on-site` repo
  - `ecr-push-bible-on-site-api` → triggers on `bible-on-site-api` repo
- Lambda Function: `ecr-to-ecs-deploy` (Python 3.12)
- IAM Roles: `ECRDeployLambdaRole`, `EventBridgeECSDeployRole`

**Flow:** ECR Push → EventBridge → Lambda → ECS UpdateService (forceNewDeployment)

### 8. `cloudwatch.yaml`
CloudWatch Log Groups and Application Auto Scaling.

**Log Groups:**
- `/ecs/bible-on-site-website` - ECS Website container logs (180 days retention)

**Auto Scaling (Target Tracking):**
- Min: 1, Max: 3 tasks
- Target CPU: 70%
- Scale-out cooldown: 300s, Scale-in cooldown: 600s

**Log Stream Pattern:** `ecs/<container-name>/<task-id>`

**Flow:** ECS Tasks → CloudWatch Logs | CloudWatch Alarms → Auto Scaling → ECS

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
RDS MySQL instance for the tanah database.

**Components:**
- DB Subnet Group: `tanah-db-subnet-group` (spans 3 AZs)
- Security Group: `tanah-rds-sg` (allows MySQL from ECS)
- RDS Instance: `tanah-mysql` (MySQL 8.4, db.t3.micro, 20GB gp3)
- SSM Parameters: Database connection info (username, dbname, host, port)

**Features:**
- Encrypted storage (AWS-managed KMS key)
- 7-day backup retention
- Not publicly accessible (VPC only)
- Password stored in SSM Parameter Store (SecureString)

**Deploy:**
```bash
aws cloudformation deploy \
  --template-file rds-mysql.yaml \
  --stack-name bible-on-site-rds \
  --capabilities CAPABILITY_NAMED_IAM \
  --region il-central-1 \
  --profile AdministratorAccess-<AWS_ACCOUNT_ID>
```

**Retrieve Connection Info:**
```bash
# Get endpoint
aws rds describe-db-instances --db-instance-identifier tanah-mysql \
  --query "DBInstances[0].Endpoint" --region il-central-1

# Get password from SSM
aws ssm get-parameter --name bible-on-site-tanah-db-password \
  --with-decryption --query "Parameter.Value" --output text --region il-central-1
```

### 12. `data-deploy-lambda.yaml`
Lambda function for deploying SQL data to RDS MySQL.

**Components:**
- S3 Bucket: `bible-on-site-data-deploy` (SQL file staging)
- Lambda Function: `bible-on-site-db-populator` (Python 3.11)
- Security Group: `data-deploy-lambda-sg` (VPC access)
- IAM Role: `DataDeployLambdaRole` (SSM read, S3 read)

**Features:**
- Runs in VPC (can access RDS)
- Gets DB credentials from SSM Parameter Store
- Downloads SQL files from S3
- Executes SQL statements against RDS
- Invoked by GitHub Actions CD workflow

**Flow:** GitHub Actions → S3 (upload SQL) → Lambda invoke → RDS MySQL

## Data Flow: ECR → ECS → nginx → Internet

1. **GitHub Actions** pushes Docker images to **ECR** (via OIDC role)
2. **ECS Fargate** pulls images from **ECR** (via task execution role)
3. **ECS tasks** register with **Cloud Map** (`website.bible-on-site.local`)
4. **nginx** resolves Cloud Map DNS to get ECS task private IPs
5. **nginx** proxies HTTPS traffic to ECS tasks on port 3000
6. **Internet users** access via תנך.co.il / תנך.com

## Current Infrastructure State

As of the last export (see git history for date):

| Resource | Value |
|----------|-------|
| **Region** | `il-central-1` (Israel) |
| **VPC** | `<VPC_ID>` (default, `172.31.0.0/16`) |
| **ECS Cluster** | `bible-on-site-cluster` |
| **ECS Service** | `bible-on-site-website` (1 task, Fargate) |
| **Cloud Map** | `bible-on-site.local` → `website.bible-on-site.local` |
| **ECR** | `bible-on-site` (website), `bible-on-site-api` (future) |
| **EC2** | `<INSTANCE_ID>` (t3.small, nginx, `<EC2_PUBLIC_IP>`) |
| **Route53** | `xn--febl3a.com`, `xn--febl3a.co.il` → `<EC2_PUBLIC_IP>` |
| **RDS** | `tanah-mysql` (MySQL 8.4, db.t3.micro, encrypted) |
| **OIDC Provider** | `token.actions.githubusercontent.com` |
| **IAM Roles** | `GitHubActionsECRDeployRole`, `ecsTaskExecutionRole` |
| **SSO Users** | `dorad` (admin), `bible-on-site-github-ci-bot` (CI) |
| **Permission Sets** | `AdministratorAccess`, `ECRDeployer` |

## Importing Existing Resources

If resources already exist, you can import them into CloudFormation:

```bash
# Example: Import existing ECR repository
aws cloudformation create-change-set \
  --stack-name bible-on-site-ecr \
  --change-set-name import-ecr \
  --change-set-type IMPORT \
  --resources-to-import "[{\"ResourceType\":\"AWS::ECR::Repository\",\"LogicalResourceId\":\"WebsiteRepository\",\"ResourceIdentifier\":{\"RepositoryName\":\"bible-on-site\"}}]" \
  --template-body file://ecr-repositories.yaml \
  --region il-central-1
```

## Deployment Cheat Sheet

**1. Login to SSO**
```bash
aws sso login --profile bible-on-site-deployer
```

## Related Documentation

- [nginx Configuration](./ec2-nginx/router/router.conf)
