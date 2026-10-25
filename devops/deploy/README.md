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
bun run deploy:ecr -- --module-name website
bun run deploy:ecr -- --module-name api
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
bun run deploy:data
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
Run `bun run test:deploy-data` from `devops/` to validate recovery without AWS access
or database changes.
Run `python -m unittest discover -s devops/deploy/data-deploy -p "test_*.py"`
from the repository root to verify that additive migrations preserve existing rows.

#### Schema-only releases

Data CI and parser tests still run for migration-only changes. When there is at
least one changed file under data/ and every such file matches
data/mysql/tanahpedia_alter_*.sql, the master release skips the full data CD job.
Related deploy-tooling, parser, test, and documentation changes do not turn that
case into a bootstrap deployment. Static/scripture SQL, pipeline data, and mixed
data changes retain the normal full-release path.

This is a routing safeguard, not proof that SQL is additive or approved. Deleted
migration files also take the manual route and must never be invoked. Deliver
each reviewed schema migration separately after explicit AWS approval and record
the production validation; merging a schema-only PR does not apply its SQL.
A tooling-only change retains the existing full-release behavior, so review its
production impact separately.

#### Mention-decoration schema recovery

The schema migration `data/mysql/tanahpedia_alter_mention_decoration.sql` creates
the missing table without replacing existing rows. It does not import annotations
or change scripture, articles, or public URLs.

Before merging, confirm that this change takes the schema-only/manual release
route. A mixed data change still triggers full data CD; do not use that route for
this single-table recovery. Keep the PR unmerged until its current AWS-impacting
changes receive explicit approval. Independently verify the live parser before
any migration execution, even when the repository tests are green.

After explicit approval of the AWS changes, use this bounded recovery procedure:

1. Verify account `250598594267` and region `il-central-1`. Download the currently
   deployed `bible-on-site-db-populator` ZIP, verify its `CodeSha256`, and keep the
   original ZIP as the rollback artifact. Record its current `RevisionId`.
2. Patch only the two table-matching regexes in the downloaded `index.py`, in
   `preprocess_sql` and `execute_sql_streaming`. Replace this exact pattern:

   ```python
   r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?'
   ```

   with:

   ```python
   r'CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)[`"]?(\w+)[`"]?'
   ```

   Refuse to package if there are not exactly two expected matches. Preserve
   every other source byte, the existing SSM credential/invocation handler, and
   every bundled dependency. Check that only `index.py` changed in the ZIP and
   run the parser-preservation tests against that actual prepared handler.
3. Update only the Lambda code, using the recorded `RevisionId` as a concurrency
   guard. Wait for a successful update and verify the deployed `CodeSha256`
   matches the prepared archive. Older parsers inject a table drop even before
   `CREATE TABLE IF NOT EXISTS`, so they must not execute this migration.
4. Upload only `tanahpedia_alter_mention_decoration.sql` to
   `bible-on-site-data-deploy`, under a unique prefix such as
   `sql/schema-recovery/<reviewed-commit>/<execution-id>/`. Invoke the preserved
   live handler with exactly this legacy payload shape:

   ```json
   {
     "sql_files": ["tanahpedia_alter_mention_decoration.sql"],
     "s3_prefix": "sql/schema-recovery/<reviewed-commit>/<execution-id>/"
   }
   ```

   The unchanged live handler retrieves its credentials from SSM. Do not add
   `db_url` or log credential values. Do not run the full `npm run deploy:data`
   payload for this recovery: it also replaces bootstrap tables and commentary
   data. Remove the temporary SQL object after verifying the invocation result.

Do not replace the live handler wholesale with the repository handler for this
repair. The repository's general deployer passes a private `db_url` payload,
which is a separate credential-contract change requiring separate approval.

Verify the table and reader query, then invalidate `tanahpedia-mention-refs` to
clear empty results cached before the schema existed. Use the existing website
`POST /api/revalidate?tag=tanahpedia-mention-refs` contract, with the credential in
the `x-revalidate-secret` header, never in the URL or logs. Verify every active
website instance was invalidated, then check a fresh chapter render and logs.
Repeating the migration must preserve existing annotations.

If application rollback is needed, leave the additive table and any rows in
place. Keep the original Lambda ZIP available, but do not restore its destructive
parser while this migration remains in the deployment manifest. A parser
rollback must first exclude the migration from subsequent data deployments.

#### Verified production recovery (2026-10-25)

The bounded recovery was applied in account 250598594267, il-central-1. The live
parser-only package has CodeSha256
lYrF4yIyfwnLBEy40yprsny6jQ8h01GK9rdbiUbU1NU=. Only the two parser expressions in
index.py changed; the credential handler and all 51 dependency entries were
preserved. The original ZIP and its verified hash are retained as private
rollback artifacts.

Only the mention-decoration CREATE TABLE migration was executed, then repeated.
Production checks passed for the 22 columns, declared indexes and foreign-key
support indexes, both foreign keys, article deletion cascade, and zero rows
before and after the repeat. The exact reader SELECT now succeeds. The sole
active website instance's mention-reference cache was invalidated, and both
public domains' health plus fresh chapter requests returned 200.

The router is not permitted to connect to RDS by the existing security groups.
Verification used read-only SQL through the existing Lambda instead; no network
policy was widened. No full bootstrap or commentary payload was run.

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
