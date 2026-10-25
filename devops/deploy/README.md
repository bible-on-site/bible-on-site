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

- **SSM Parameter Store** supplies the database URL as a SecureString. The deployer
  passes it privately to the Lambda invocation and never logs the payload.

**Commands:**
```bash
# From the repository root, validate parser compatibility without changing a database
python devops/deploy/data-deploy/validate_lambda_parser.py --parse-only

cd devops
npm run deploy:data
```

The validator and deployer share `data-deploy/sql-files.json`. The validator resolves
SQL paths from its own location, so it also works from other working directories.
Without `--parse-only`, it executes SQL (including injected table/view drops): use
that mode only with a disposable local database.

An idle VPC Lambda can reject its first invocation with `ResourceNotReadyException`
while AWS restores its resources. The deployer retries only that pre-execution
rejection, allowing 30 waits of 10 seconds before failing. SQL uploads stay in S3
throughout recovery and are cleaned up after invocation completes or fails. Other
invocation errors and function execution failures still fail the deployment.
See [AWS Lambda function states](https://docs.aws.amazon.com/lambda/latest/dg/functions-states.html).
Run `npm run test:deploy-data` from `devops/` to validate recovery without AWS access
or database changes.
Run `python -m unittest discover -s devops/deploy/data-deploy -p "test_*.py"`
from the repository root to verify that additive migrations preserve existing rows.

#### Mention-decoration schema recovery

The schema migration `data/mysql/tanahpedia_alter_mention_decoration.sql` creates
the missing table without replacing existing rows. It does not import annotations
or change scripture, articles, or public URLs.

After explicit approval of the AWS changes, deploy the updated populator Lambda
parser first. Older versions inject a table drop even before `CREATE TABLE IF NOT
EXISTS`, so they must not execute this migration. Then upload only this migration
and invoke the existing Lambda contract with `sql_files` set to
`["tanahpedia_alter_mention_decoration.sql"]`, the upload's `s3_prefix`, and the
database URL resolved securely by the deployment caller. `buildDeployPayload`
supports this single-file selection. Do not run the full `npm run deploy:data`
payload for this recovery: it also replaces bootstrap tables and commentary data.

Verify the table and reader query, then invalidate `tanahpedia-mention-refs` to
clear empty results cached before the schema existed. Repeating the migration
must preserve existing annotations. If application rollback is needed, leave the
additive table and any rows in place; do not restore the old destructive parser
while this migration remains in the deployment manifest.

**Required Environment Variables (set via OIDC in CI):**
- `AWS_REGION` - AWS region (e.g., `il-central-1`)

**SSM Parameters used:**
- `bible-on-site-tanah-db-url` (SecureString)

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
    ├── index.mts       # DataDeployer (extends DeployerBase)
    ├── sql-files.json  # Shared production SQL deployment manifest
    └── validate_lambda_parser.py  # Lambda-compatible SQL validation
```
