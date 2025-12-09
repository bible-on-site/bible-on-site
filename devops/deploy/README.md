# Deployment

This directory contains deployment scripts for the Bible On Site project.

## Deployment Methods

### 1. AWS ECR Deployment (Recommended for production)

Pushes Docker images to AWS Elastic Container Registry (ECR) using IAM Identity Center (SSO) authentication.

**Setup guide:** See [management/aws/ECR-DEPLOYMENT.md](../../management/aws/ECR-DEPLOYMENT.md)

**Commands:**
```bash
# First, login to SSO
aws sso login --profile bible-on-site-deployer

# Then deploy
cd devops
npm run deploy:ecr -- --module-name website
npm run deploy:ecr -- --module-name api
```

### 2. Bare Metal Deployment (Legacy/Deprecated)

Deploys Docker images directly to bare metal servers via SSH.

**Command:**
```bash
cd devops
npm run deploy:bare-metal -- --module-name website
npm run deploy:bare-metal -- --module-name api
```

## Directory Structure

```
deploy/
├── README.md           # This file
├── ecr-deploy/         # AWS ECR deployment scripts
│   ├── .env.example    # Template for AWS SSO credentials
│   ├── index.mts       # Entry point
│   ├── ecr-client.mts  # AWS ECR client utilities
│   ├── ecr-deployer-base.mts  # Base deployer class
│   ├── api-deployer.mts       # API-specific deployer
│   └── website-deployer.mts   # Website-specific deployer
└── bare-metal-deploy/  # Bare metal deployment scripts (legacy)
    ├── .env            # SSH credentials (gitignored)
    ├── index.mts       # Entry point
    ├── deployer-base.mts
    ├── api-deployer.mts
    ├── website-deployer.mts
    └── ssh/            # SSH connection utilities
```
