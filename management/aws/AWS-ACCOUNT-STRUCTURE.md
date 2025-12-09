# AWS Account Structure

This document describes the AWS account structure for the Bible On Site project.

> **Note**: Sensitive values like AWS Account ID are masked with `<AWS_ACCOUNT_ID>`.
> To get the actual value, run: `aws sts get-caller-identity --query Account --output text`

## Account Overview

| Property | Value |
|----------|-------|
| **Account ID** | `<AWS_ACCOUNT_ID>` |
| **Region** | `il-central-1` (Israel) |
| **Organization** | bible-on-site |

---

## Identity Management

We use **IAM Identity Center (SSO)** for human users and **IAM OIDC** for CI/CD.

### IAM Identity Center Users

| Username | Display Name | Purpose |
|----------|--------------|---------|
| `dorad` | Dorad Levinshtein | Administrator / Developer |
| `bible-on-site-github-ci-bot` | bible on site github ci bot | CI/CD automation (if using SSO) |

### Permission Sets (IAM Identity Center)

| Permission Set | Description | Assigned To |
|----------------|-------------|-------------|
| `AdministratorAccess` | Full AWS access | `dorad` |
| `ECRDeployer` | Push/pull images to ECR | `dorad`, deployment users |

### IAM Roles (Traditional IAM)

| Role | Purpose | Trust Policy |
|------|---------|--------------|
| `GitHubActionsECRDeployRole` | GitHub Actions OIDC for ECR deployment | GitHub OIDC provider (repo: `bible-on-site/bible-on-site`) |

### IAM Policies

| Policy | Description | Attached To |
|--------|-------------|-------------|
| `GitHubActionsECRDeployPolicy` | ECR push/pull permissions | `GitHubActionsECRDeployRole` |

---

## Authentication Methods

### 1. Local Development (Human Users)

Uses **IAM Identity Center (SSO)** with temporary credentials.

```bash
# Login
aws sso login --profile bible-on-site-deployer

# Verify
aws sts get-caller-identity --profile bible-on-site-deployer
```

**Benefits**:
- No long-lived credentials stored locally
- MFA enforced at identity provider level
- Centralized user management

### 2. GitHub Actions (CI/CD)

Uses **OIDC (OpenID Connect)** with temporary credentials - no secrets stored in GitHub.

```yaml
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
    aws-region: ${{ vars.AWS_REGION }}
```

**Benefits**:
- No AWS credentials stored in GitHub secrets
- Credentials automatically rotated per workflow run
- Access restricted to specific repository

---

## GitHub Repository Secrets & Variables

### Secrets

| Name | Value | Description |
|------|-------|-------------|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<AWS_ACCOUNT_ID>:role/GitHubActionsECRDeployRole` | IAM role for OIDC |
| `AWS_REGION` | `il-central-1` | AWS region |
| `AWS_ACCOUNT_ID` | `<AWS_ACCOUNT_ID>` | AWS account ID |

---

## ECR Repositories

| Repository | Description | Image Tag Format |
|------------|-------------|------------------|
| `bible-on-site` | Next.js website | `v<version>`, `latest` |
| `bible-on-site-api` | Rust API | `v<version>`, `latest` |

**Full URI**: `<AWS_ACCOUNT_ID>.dkr.ecr.il-central-1.amazonaws.com/<repository>`

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    AWS Account: <AWS_ACCOUNT_ID>                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────┐    ┌─────────────────────────────────┐ │
│  │  IAM Identity Center │    │           IAM                   │ │
│  │       (SSO)          │    │                                 │ │
│  ├─────────────────────┤    ├─────────────────────────────────┤ │
│  │ Users:               │    │ OIDC Provider:                  │ │
│  │ • dorad              │    │ • token.actions.githubusercontent│ │
│  │ • bible-on-site-     │    │   .com                          │ │
│  │   github-ci-bot      │    │                                 │ │
│  │                      │    │ Roles:                          │ │
│  │ Permission Sets:     │    │ • GitHubActionsECRDeployRole    │ │
│  │ • AdministratorAccess│    │                                 │ │
│  │ • ECRDeployer        │    │ Policies:                       │ │
│  │                      │    │ • GitHubActionsECRDeployPolicy  │ │
│  └─────────────────────┘    └─────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                          ECR                                 ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ Repositories:                                                ││
│  │ • bible-on-site      (Next.js website)                      ││
│  │ • bible-on-site-api  (Rust API)                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

                    ▲                           ▲
                    │                           │
           SSO Login│                    OIDC Token
                    │                           │
        ┌───────────┴───────┐       ┌───────────┴───────┐
        │  Local Developer  │       │   GitHub Actions   │
        │  (aws sso login)  │       │   (OIDC)          │
        └───────────────────┘       └───────────────────┘
```

---

## Related Documentation

- [ECR Deployment Guide](./ECR-DEPLOYMENT.md) - How to deploy to ECR
