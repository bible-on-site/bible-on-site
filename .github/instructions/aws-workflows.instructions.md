---
description: "AWS infrastructure, ECS/SSM production operations, and GitHub Actions workflow guidelines"
applyTo: ".github/workflows/**, docs/aws/**, devops/deploy/**, web/api/Dockerfile, web/bible-on-site/Dockerfile"
---

# AWS & GitHub Actions

## AWS

- Connect: `aws sso login --profile AdministratorAccess-<AccountID>`.
- Every accepted change must land in IaC under `infrastructure/`, but never run CloudFormation from those templates — they are reference-only. Update `docs/aws/` when the process changes.

### Authentication And Secrets

- On SSO expiry, re-run `aws sso login` and resume; never route credentials through chat.
- Generate secrets without printing them: pass decrypted values only through short-lived shell variables, never `echo` them, and `unset` immediately after the request.
- Store bearer/client secrets as SSM `SecureString`, granting the ECS execution role access to the exact parameter ARN while preserving every existing policy resource.
- Git Bash rewrites leading-slash SSM names as Windows paths — use the repository's root-level name or prefix with `MSYS_NO_PATHCONV=1`.

### ECS Task Revisions

1. Inspect the service's current task definition and running task first.
2. Clone the full task-definition JSON, strip only AWS response metadata, and make the smallest additive change — preserving image, roles, networking, logging, health checks, resources, environment, and existing secret mappings.
3. Register the revision, update the service, and wait for replacement.
4. `aws ecs wait services-stable` is not enough: re-query until there is one primary deployment, desired/running counts match, pending is zero, and `rolloutState` is `COMPLETED`.
5. Verify the running revision, health/logs, and public health endpoint, and check the reported application version separately — a successful task-definition/secret rollout does not prove a newly merged image is deployed.
6. Record the accepted IAM, parameter, and task-definition mapping in IaC/docs so a later deployment cannot erase the manual recovery.

### Data Deployment

- The production db-populator Lambda lives outside this repository — diagnose failures in `/aws/lambda/bible-on-site-db-populator`, not from wrapper output.
- Data release gating must follow actual Data/Tanahpedia changes; an intentionally skipped optional artifact job must not suppress a required schema release.
- The SQL deployer and parser validator share `devops/deploy/data-deploy/sql-files.json`; validate every listed file with the Lambda-compatible parser before deploying.

## GitHub Actions

Before editing `.github/workflows/`, re-enable the `github.vscode-github-actions` extension if needed; disable it again afterwards to keep the problems view clean.
