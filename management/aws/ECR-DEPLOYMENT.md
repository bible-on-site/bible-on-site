# AWS ECR Deployment Setup

This guide covers how to set up AWS ECR deployment for the Bible On Site project using **IAM Identity Center (SSO)** - the modern, recommended approach for AWS authentication.

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
> YourAccount (123456789012)

Using the account ID 123456789012
There are N roles available to you.
> ECRDeployer

CLI default client Region [None]: us-east-1
CLI default output format [None]: json
Profile name [ECRDeployer-123456789012]: bible-on-site-deployer
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
# AWS_ACCOUNT_ID=123456789012
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
