# Deployment

This directory contains deployment scripts for the Bible On Site project.

## Deployment Methods

### 1. AWS ECR Deployment (Recommended for production)

Pushes Docker images to AWS Elastic Container Registry (ECR) using IAM Identity Center (SSO) authentication.

**Setup guide:** See [CloudFormation documentation](../../docs/aws/cloudformation/cloudformation.md) for ECR and OIDC configuration.

**Commands:**
```bash
# First, login to SSO
aws sso login --profile bible-on-site-deployer

# Then deploy
cd devops
npm run deploy:ecr -- --module-name website
npm run deploy:ecr -- --module-name api
```

### 2. Data Deployment (Database Population)

Populates the production database with SQL files from the `data/mysql/` directory.

- **SSM Parameter Store** provides: username, password, database name
- **RDS Describe** provides: host, port (from endpoint)

**Commands:**
```bash
cd devops
npm run deploy:data
```

**Required Environment Variables (set via OIDC in CI):**
- `AWS_REGION` - AWS region (e.g., `il-central-1`)

**SSM Parameters used:**
- `bible-on-site-tanah-db-username`
- `bible-on-site-tanah-db-password` (SecureString)
- `bible-on-site-tanah-db-name`

## Directory Structure

```
deploy/
├── README.md           # This file
├── deployer-base.mts   # Abstract base deployer class
├── ecr-deploy/         # AWS ECR deployment scripts
│   ├── .env.example    # Template for AWS SSO credentials
│   ├── index.mts       # Entry point
│   ├── ecr-client.mts  # AWS ECR client utilities
│   ├── ecr-deployer-base.mts  # ECR-specific deployer (extends DeployerBase)
│   ├── api-deployer.mts       # API-specific deployer
│   └── website-deployer.mts   # Website-specific deployer
└── data-deploy/        # Database deployment scripts
    ├── .env.example    # Template for environment variables
    └── index.mts       # DataDeployer (extends DeployerBase)
```
