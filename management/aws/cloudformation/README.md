# AWS CloudFormation Templates

This directory contains CloudFormation templates that document and can recreate the AWS infrastructure for the Bible On Site project.

> **⚠️ Important**: These templates are for **documentation and disaster recovery** purposes. The actual infrastructure was created manually or via CLI. Use these templates to understand the current state or to recreate resources if needed.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                  Internet                                        │
│                         תנך.co.il / תנך.com (DNS)                                │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  EC2: nginx Reverse Proxy (ec2-nginx.yaml)                                      │
│  ─────────────────────────────────────────                                      │
│  • Public IP: <MASKED>                                                          │
│  • SSL termination (Let's Encrypt)                                              │
│  • Routes to ECS via Cloud Map DNS                                              │
│  • Security Group: HTTP/HTTPS/SSH inbound                                       │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │
                    VPC Private Network │ 172.31.0.0/16
                    (vpc-networking.yaml)
                                        │
            ┌───────────────────────────┴───────────────────────────┐
            │                                                       │
            ▼                                                       ▼
┌───────────────────────────────┐               ┌───────────────────────────────┐
│  Cloud Map Service Discovery  │               │  ECR Repositories             │
│  (ecs-services.yaml)          │               │  (ecr-repositories.yaml)      │
│  ───────────────────────────  │               │  ─────────────────────────    │
│  Namespace: bible-on-site.local│               │  • bible-on-site (website)   │
│  • website.bible-on-site.local │◄──────────────│  • bible-on-site-api         │
│  • api.bible-on-site.local     │   pulls from  │                              │
└───────────────────┬───────────┘               └───────────────────────────────┘
                    │                                          ▲
                    ▼                                          │
┌───────────────────────────────────────────────────────────────────────────────┐
│  ECS Fargate Cluster (ecs-services.yaml)                                      │
│  ───────────────────────────────────────                                      │
│  Cluster: bible-on-site-cluster                                               │
│  ┌─────────────────────────────────┐    ┌─────────────────────────────────┐  │
│  │ Service: bible-on-site-website  │    │ Service: bible-on-site-api     │  │
│  │ Port: 3000                      │    │ Port: 3003 (future)            │  │
│  │ Image: ECR/bible-on-site        │    │ Image: ECR/bible-on-site-api   │  │
│  └─────────────────────────────────┘    └─────────────────────────────────┘  │
│                                                                               │
│  Task Execution Role: ecsTaskExecutionRole                                    │
│  • ECR pull permissions                                                       │
│  • CloudWatch Logs permissions                                                │
└───────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│  IAM & Security (github-oidc.yaml, iam-identity-center.yaml)                  │
│  ───────────────────────────────────────────────────────────                  │
│  • GitHub OIDC Provider → GitHubActionsECRDeployRole (CI/CD)                  │
│  • IAM Identity Center → AdministratorAccess, ECRDeployer (SSO)               │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Sensitive Information

Sensitive values are masked with placeholders. To retrieve actual values:

| Placeholder | How to Retrieve |
|-------------|-----------------|
| `<AWS_ACCOUNT_ID>` | `aws sts get-caller-identity --query Account --output text` |
| `<SSO_INSTANCE_ARN>` | `aws sso-admin list-instances --query "Instances[0].InstanceArn" --output text --region il-central-1` |
| `<IDENTITY_STORE_ID>` | `aws sso-admin list-instances --query "Instances[0].IdentityStoreId" --output text --region il-central-1` |
| `<EC2_PUBLIC_IP>` | `aws ec2 describe-instances --filters "Name=tag:Name,Values=nginx-router" --query "Reservations[0].Instances[0].PublicIpAddress" --output text --region il-central-1` |
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

### 7. `master-stack.yaml`
Nested stack that deploys all components together (for reference).

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
| **EC2** | `<INSTANCE_ID>` (t3.small, nginx) |
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

- [nginx Configuration](./appendix/router/router.conf)
