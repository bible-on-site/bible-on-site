# AWS ECR Deployment Setup

This guide covers how to set up AWS ECR deployment for the Bible On Site project using **IAM Identity Center (SSO)** - the modern, recommended approach for AWS authentication.

> **Note**: Sensitive values like AWS Account ID are masked with `<AWS_ACCOUNT_ID>`.
> To get the actual value, run: `aws sts get-caller-identity --query Account --output text`

## Prerequisites

- AWS Account with IAM Identity Center enabled
- AWS CLI v2 installed ([Installation guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))
- Docker installed locally
- Node.js 22.2.0 or higher

---

## AWS Console Setup

### Step 1: Enable IAM Identity Center

1. Go to **AWS Console** → Search for **IAM Identity Center**
2. If not enabled, click **Enable IAM Identity Center**
3. Choose **Enable with AWS Organizations** (recommended) or standalone

### Step 2: Create a User (if needed)

If you don't already have a user in IAM Identity Center:

1. Go to **IAM Identity Center** → **Users**
2. Click **Add user**
3. Fill in email, first name, last name
4. Click **Next** → **Add user**
5. The user will receive an email to set up their password

### Step 3: Create a Permission Set for ECR Access

1. Go to **IAM Identity Center** → **Permission sets**
2. Click **Create permission set**
3. Choose **Custom permission set**
4. Name it: `ECRDeployer`
5. Under **Inline policy**, add:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "ECRAuth",
            "Effect": "Allow",
            "Action": [
                "ecr:GetAuthorizationToken"
            ],
            "Resource": "*"
        },
        {
            "Sid": "ECRRepository",
            "Effect": "Allow",
            "Action": [
                "ecr:CreateRepository",
                "ecr:DescribeRepositories",
                "ecr:DescribeImages",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "ecr:InitiateLayerUpload",
                "ecr:UploadLayerPart",
                "ecr:CompleteLayerUpload",
                "ecr:PutImage"
            ],
            "Resource": [
                "arn:aws:ecr:*:*:repository/bible-on-site",
                "arn:aws:ecr:*:*:repository/bible-on-site-api"
            ]
        },
        {
            "Sid": "STSGetCallerIdentity",
            "Effect": "Allow",
            "Action": [
                "sts:GetCallerIdentity"
            ],
            "Resource": "*"
        }
    ]
}
```

6. Set session duration (e.g., 4 hours)
7. Click **Create**

### Step 4: Assign Permission Set to User and Account

1. Go to **IAM Identity Center** → **AWS accounts**
2. Select your AWS account
3. Click **Assign users or groups**
4. Select your user
5. Click **Next**
6. Select the **ECRDeployer** permission set
7. Click **Submit**

### Step 5: Get Your SSO Start URL

1. Go to **IAM Identity Center** → **Settings**
2. Copy the **AWS access portal URL** (looks like: `https://d-xxxxxxxxxx.awsapps.com/start`)

---

## Local CLI Setup

### Step 1: Configure AWS CLI with SSO

Run the SSO configuration wizard:

```bash
aws configure sso
```

Follow the prompts:

```
SSO session name (Recommended): bible-on-site-sso
SSO start URL [None]: https://d-xxxxxxxxxx.awsapps.com/start
SSO region [None]: us-east-1
SSO registration scopes [None]: sso:account:access
```

A browser will open for authentication. After signing in:

```
There are N AWS accounts available to you.
> YourAccount (<AWS_ACCOUNT_ID>)

Using the account ID <AWS_ACCOUNT_ID>
There are N roles available to you.
> ECRDeployer

CLI default client Region [None]: us-east-1
CLI default output format [None]: json
Profile name [ECRDeployer-<AWS_ACCOUNT_ID>]: bible-on-site-deployer
```

### Step 2: Login to SSO

Before using the deploy script, login to your SSO session:

```bash
aws sso login --profile bible-on-site-deployer
```

This opens a browser for authentication. Your credentials are cached for the session duration.

### Step 3: Create .env File

```bash
cd devops/deploy/ecr-deploy
cp .env.example .env
```

Edit the `.env` file:

```dotenv
# AWS Region
AWS_REGION=us-east-1

# AWS SSO Profile name (from step 1)
AWS_PROFILE=bible-on-site-deployer

# Optional: Account ID (auto-detected if not set)
# AWS_ACCOUNT_ID=<AWS_ACCOUNT_ID>
```

---

## Usage

### Login to SSO (required before deploying)

```bash
aws sso login --profile bible-on-site-deployer
```

### Deploy Website to ECR

```bash
cd devops
npm run deploy:ecr -- --module-name website
```

### Deploy API to ECR

```bash
cd devops
npm run deploy:ecr -- --module-name api
```

### Deploy with Specific Version

```bash
npm run deploy:ecr -- --module-name website --module-version 1.2.3
```

---

## What Happens During Deployment

1. **SSO Authentication**: Uses cached SSO credentials from your profile
2. **Account ID Detection**: Automatically fetches from STS if not in `.env`
3. **Version Check**: Ensures local version is newer than ECR version
4. **Repository Check**: Creates ECR repository if it doesn't exist
5. **Docker Authentication**: Gets temporary ECR token and authenticates Docker
6. **Build/Tag**: Builds Docker image (if not exists locally) and tags it
7. **Push**: Pushes the image to ECR with version tag and `latest` tag
8. **Verification**: Confirms the image was pushed successfully

---

## ECR Repositories

| Repository | Description |
|------------|-------------|
| `bible-on-site` | Next.js website |
| `bible-on-site-api` | Rust API |

---

## Troubleshooting

### "Missing AWS_PROFILE environment variable"

- Ensure `.env` file exists in `devops/deploy/ecr-deploy/`
- Set `AWS_PROFILE` to your SSO profile name

### "The SSO session associated with this profile has expired"

Run the SSO login again:
```bash
aws sso login --profile bible-on-site-deployer
```

### "AccessDeniedException"

- Verify the permission set has all required ECR permissions
- Check the permission set is assigned to your user for the target account

### "Failed to get AWS Account ID from STS"

- Your SSO session may have expired - run `aws sso login`
- Verify the profile name in `.env` matches your CLI configuration

### "Local version is not newer than remote version"

- Either bump your local version, or
- Use `--module-version` flag to specify a newer version

---

## Session Management

### Check SSO Session Status

```bash
aws sts get-caller-identity --profile bible-on-site-deployer
```

### Logout from SSO

```bash
aws sso logout
```

---

## Security Benefits of IAM Identity Center

- **No long-lived credentials**: Uses temporary, automatically rotated credentials
- **Centralized access management**: Manage all users and permissions in one place
- **MFA support**: Enforce multi-factor authentication at the identity provider level
- **Audit trail**: All access is logged in CloudTrail
- **Easy offboarding**: Disable user access instantly from one central location

---

## CI/CD Setup (GitHub Actions with OIDC)

For automated deployments from GitHub Actions, we use **OpenID Connect (OIDC)** - no need to store AWS credentials as secrets.

> **Note**: GitHub Actions OIDC uses **IAM** (not IAM Identity Center). IAM Identity Center is for managing human users with SSO. GitHub Actions is an external OIDC provider that must be registered in IAM.

### Option A: CLI Setup (Recommended)

Run these commands to set up OIDC:

```bash
# Set variables
export AWS_ACCOUNT_ID="<AWS_ACCOUNT_ID>"
export AWS_REGION="il-central-1"
export GITHUB_ORG="bible-on-site"
export GITHUB_REPO="bible-on-site"

# Step 1: Create OIDC Identity Provider
aws iam create-open-id-connect-provider \
  --url "https://token.actions.githubusercontent.com" \
  --client-id-list "sts.amazonaws.com" \
  --thumbprint-list "ffffffffffffffffffffffffffffffffffffffff"

# Step 2: Create the IAM policy
cat > /tmp/ecr-deploy-policy.json << 'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "ECRAuth",
            "Effect": "Allow",
            "Action": ["ecr:GetAuthorizationToken"],
            "Resource": "*"
        },
        {
            "Sid": "ECRRepository",
            "Effect": "Allow",
            "Action": [
                "ecr:CreateRepository",
                "ecr:DescribeRepositories",
                "ecr:DescribeImages",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "ecr:InitiateLayerUpload",
                "ecr:UploadLayerPart",
                "ecr:CompleteLayerUpload",
                "ecr:PutImage"
            ],
            "Resource": [
                "arn:aws:ecr:*:*:repository/bible-on-site",
                "arn:aws:ecr:*:*:repository/bible-on-site-api"
            ]
        },
        {
            "Sid": "STSGetCallerIdentity",
            "Effect": "Allow",
            "Action": ["sts:GetCallerIdentity"],
            "Resource": "*"
        }
    ]
}
EOF

aws iam create-policy \
  --policy-name GitHubActionsECRDeployPolicy \
  --policy-document file:///tmp/ecr-deploy-policy.json

# Step 3: Create the trust policy for the role
cat > /tmp/trust-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
                },
                "StringLike": {
                    "token.actions.githubusercontent.com:sub": "repo:${GITHUB_ORG}/${GITHUB_REPO}:*"
                }
            }
        }
    ]
}
EOF

# Step 4: Create the IAM role
aws iam create-role \
  --role-name GitHubActionsECRDeployRole \
  --assume-role-policy-document file:///tmp/trust-policy.json

# Step 5: Attach the policy to the role
aws iam attach-role-policy \
  --role-name GitHubActionsECRDeployRole \
  --policy-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:policy/GitHubActionsECRDeployPolicy"

# Print the role ARN (needed for GitHub secrets)
echo "Role ARN: arn:aws:iam::${AWS_ACCOUNT_ID}:role/GitHubActionsECRDeployRole"
```

### Option B: Console Setup

#### Step 1: Create OIDC Identity Provider

1. Go to **AWS Console** → **IAM** → **Identity providers**
2. Click **Add provider**
3. Choose **OpenID Connect**
4. Provider URL: `https://token.actions.githubusercontent.com`
5. Click **Get thumbprint**
6. Audience: `sts.amazonaws.com`
7. Click **Add provider**

#### Step 2: Create IAM Role for GitHub Actions

1. Go to **IAM** → **Roles** → **Create role**
2. Choose **Web identity**
3. Identity provider: `token.actions.githubusercontent.com`
4. Audience: `sts.amazonaws.com`
5. Click **Next**
6. Click **Create policy** → paste the following:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "ECRAuth",
            "Effect": "Allow",
            "Action": [
                "ecr:GetAuthorizationToken"
            ],
            "Resource": "*"
        },
        {
            "Sid": "ECRRepository",
            "Effect": "Allow",
            "Action": [
                "ecr:CreateRepository",
                "ecr:DescribeRepositories",
                "ecr:DescribeImages",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "ecr:InitiateLayerUpload",
                "ecr:UploadLayerPart",
                "ecr:CompleteLayerUpload",
                "ecr:PutImage"
            ],
            "Resource": [
                "arn:aws:ecr:*:*:repository/bible-on-site",
                "arn:aws:ecr:*:*:repository/bible-on-site-api"
            ]
        },
        {
            "Sid": "STSGetCallerIdentity",
            "Effect": "Allow",
            "Action": [
                "sts:GetCallerIdentity"
            ],
            "Resource": "*"
        }
    ]
}
```

7. Name it: `GitHubActionsECRDeployPolicy`
8. Back in role creation, attach this policy
9. Name the role: `GitHubActionsECRDeployRole`
10. Click **Create role**

#### Step 3: Restrict Role to Your Repository

1. Go to **IAM** → **Roles** → **GitHubActionsECRDeployRole**
2. Click **Trust relationships** → **Edit trust policy**
3. Update to restrict to your repository:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
                },
                "StringLike": {
                    "token.actions.githubusercontent.com:sub": "repo:bible-on-site/bible-on-site:*"
                }
            }
        }
    ]
}
```

4. Replace `<AWS_ACCOUNT_ID>` with your AWS account ID
5. Click **Update policy**

### Step 4: Configure GitHub Repository

1. Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions**
2. Add the following **secrets**:
   - `AWS_DEPLOY_ROLE_ARN`: `arn:aws:iam::<AWS_ACCOUNT_ID>:role/GitHubActionsECRDeployRole`
   - `AWS_REGION`: `il-central-1` (or your region)
   - `AWS_ACCOUNT_ID`: `<AWS_ACCOUNT_ID>`

### How It Works

1. GitHub Actions workflow requests a token from GitHub's OIDC provider
2. The token includes claims about the repository, branch, and workflow
3. AWS verifies the token signature and validates the claims
4. If valid, AWS returns temporary credentials for the role
5. The deployment script uses these credentials to push to ECR

**Benefits**:
- No long-lived AWS credentials stored in GitHub secrets
- Credentials are automatically rotated per workflow run
- Fine-grained access control based on repository, branch, or environment
