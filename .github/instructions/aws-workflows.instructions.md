---
description: "AWS infrastructure, ECS/SSM production operations, and GitHub Actions workflow guidelines"
applyTo: ".github/workflows/**, docs/aws/**, devops/deploy/**, web/api/Dockerfile, web/bible-on-site/Dockerfile"
---

# AWS & GitHub Actions

## AWS

- Connect: `aws sso login --profile AdministratorAccess-<AccountID>`.
- All accepted changes must be reflected in IaC under `infrastructure/`.
- Do **not** run CloudFormation from `infrastructure/` templates; they are reference-only.
- When changing AWS process, update `docs/aws/`.

### Authentication And Secrets

- When SSO expires, run `aws sso login` and resume the operation; do not route credentials through chat.
- Generate secret values without printing them. Pass decrypted values only through short-lived shell variables, never `echo` them, and `unset` them immediately after the authenticated request.
- Store bearer/client secrets as SSM `SecureString`. Grant the ECS execution role access to the exact parameter ARN while preserving every existing policy resource.
- On Git Bash, a leading-slash SSM parameter can be rewritten as a Windows path. Use the repository's established root-level name or prefix the command with `MSYS_NO_PATHCONV=1`.

### ECS Task Revisions

1. Inspect the service's current task definition and running task before changing it.
2. Clone the complete current task-definition JSON, remove only AWS response metadata, and make the smallest additive change. Preserve image, roles, networking, logging, health checks, resources, environment, and existing secret mappings.
3. Register a new revision, update the service, and wait for replacement.
4. Do not stop at `aws ecs wait services-stable`. Re-query until there is one primary deployment, desired/running counts match, pending is zero, and `rolloutState` is explicitly `COMPLETED`.
5. Verify the running task revision, health/logs, and the public health endpoint. Check the reported application version separately: a successful task-definition/secret rollout does not prove that a newly merged image is deployed.
6. Record the accepted IAM, parameter, and task-definition mapping in repository IaC/docs so a later deployment cannot erase the manual recovery change.

### Data Deployment

- The production db-populator Lambda code is external to this repository. Diagnose invocation failures in `/aws/lambda/bible-on-site-db-populator` rather than guessing from wrapper output.
- Data release gating must follow actual Data/Tanahpedia changes. An intentionally skipped optional artifact job must not suppress a required schema release.
- The production SQL deployer and parser validator share `devops/deploy/data-deploy/sql-files.json`. Validate every listed SQL file with the Lambda-compatible parser before deployment.

## GitHub Actions

Before editing `.github/workflows/`:

1. Re-enable VS Code extension `github.vscode-github-actions` if needed.
2. After changes, remove or disable the extension to avoid noise in the problems view.
