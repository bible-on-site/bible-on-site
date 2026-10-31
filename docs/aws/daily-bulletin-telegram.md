# Telegram daily bulletin: private test setup

Telegram uses an immutable prepared bulletin PDF and the existing bulletin SQS worker. Settings start in `test`; only an authenticated, explicit revision-checked change can select the real audience. A private test does not activate the public channel. No scheduled public posting is enabled by this change.

The Telegram token must be rotated before any provider call if a legacy value was exposed. Do not read or reuse the legacy token. The operator enters the replacement directly into the existing account's Parameter Store console as the SecureString `/bible-on-site-telegram-bot-token`, using the default AWS-managed SSM key. Do not put it in chat, source, CloudFormation parameters/outputs, task-definition `environment`, command-line arguments, logs or local scope files. CloudFormation's parameter resource does not support SecureString, so this template does not create/store the value. [AWS parameter resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ssm-parameter.html)

## Additive database deployment

Apply only `data/mysql/tanah_daily_bulletin_telegram_upgrade.sql` through the reviewed manual database migration path after specific approval. It depends on the existing bulletin schema. It adds `tanah_daily_bulletin_telegram_settings` and `tanah_daily_bulletin_telegram_job`; `INSERT IGNORE` seeds the test singleton without changing an existing selection. No saved PDF/article, email setting/subscriber/job/recipient, or existing channel delivery row is replaced. Repeated migration preserves prior attempts, uncertain outcomes and provider IDs.

The bootstrap manifest includes the new migration after the bulletin schema for fresh local/test databases. Changes limited to either bulletin migration plus their Rust preservation fixture remain schema-only/manual in CI; do not run a full production bootstrap to add Telegram. SQL parser tests prevent the legacy deployment's table-replacement rewrite from seeing the split creation statements. Native MySQL preservation tests create/drop only their own unique fixture database, never the SES validation databases.

Each job freezes bot ID, numeric chat ID, PDF hash, filename and caption before SQS publication. The real idempotency key is always `production`, unique by date/audience/key; a provider message is unique per target chat. An uncertain or already claimed attempt cannot be reset or automatically reposted. Test jobs never mark the production Telegram delivery row sent. Keep application content edits in the database deployment/admin path; this migration is not a content seed.

## Execution-role permission review

Use the existing `AdministratorAccess-250598594267` profile in `il-central-1`. Before any write, verify account `250598594267`, the current admin task's execution role, current inline/managed policies, and token parameter **metadata** only. Never request/decrypt the token to inspect configuration. The tracked ECS template currently names `ecsTaskExecutionRole`, but the live task is authoritative. The read-only live audit confirmed that the current role has AmazonECSTaskExecutionRolePolicy attached and inline CloudWatchLogsFullAccess and SSMParameterReadAccess policies. The SSM policy covers the existing database, admin and revalidation parameter prefixes and the Tanahpedia revision API-key parameter; it does not cover the proposed Telegram token parameter. The optional exact-parameter policy is therefore needed for this token path. No IAM, parameter or ECS changes were made during that audit.

ECS reads the parameter at container startup through the **execution role**; the application task role needs no SSM permission and application code reads only `BULLETIN_TELEGRAM_BOT_TOKEN`. The required action is `ssm:GetParameters`. A customer-managed KMS key would additionally require a separately reviewed exact-key decrypt grant; this template grants no KMS, Secrets Manager, wildcard or application-role access. [AWS execution-role permissions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)

If the live execution role already covers the exact parameter, skip the optional IAM stack. Otherwise review `docs/aws/cloudformation/daily-bulletin-telegram.yaml`: its only resource adds `ssm:GetParameters` on this one parameter ARN to that existing execution role. It does not create an IAM role, secret, queue, ECS service or bot/chat configuration. Do not broaden an existing shared policy merely to fit this feature. A different execution role name must be supplied explicitly and reviewed.

Local regression, with no AWS calls:

```powershell
bun test devops/daily-bulletin-infra.test.mjs
python -B -m unittest discover -s devops/deploy/data-deploy -p test_lambda_parser.py
```

Read-only template validation, after an active approved SSO session:

```powershell
aws cloudformation validate-template --template-body file://docs/aws/cloudformation/daily-bulletin-telegram.yaml --profile AdministratorAccess-250598594267 --region il-central-1 --cli-connect-timeout 5 --cli-read-timeout 15
```

Template validation does not apply permissions or prove the live role/parameter. Any stack execution, IAM change, SSM entry or ECS rollout requires approval for that specific AWS-impacting change. Prepare/review a change set; do not auto-deploy this optional stack from application CI.

## Preserve the existing ECS task and inject the token

Clone the **current live** `bible-on-site-admin` task definition, preserving all existing containers, environment/secrets, roles, ports, logging, resources, image and the SES worker configuration. Keep `stopTimeout:120`. Append one entry to the admin container's `secrets`, never to `environment`:

```json
{
  "name": "BULLETIN_TELEGRAM_BOT_TOKEN",
  "valueFrom": "arn:aws:ssm:il-central-1:250598594267:parameter/bible-on-site-telegram-bot-token"
}
```

Set these server-only nonsecret settings separately; do not use `VITE_` names:

| Variable | Initial value |
| --- | --- |
| `BULLETIN_TELEGRAM_BOT_USERNAME` | Exact username of the rotated, operator-approved bot |
| `BULLETIN_TELEGRAM_TEST_CHAT_ID` | Explicit approved numeric private channel, group or supergroup ID |
| `BULLETIN_TELEGRAM_REAL_CHAT_ID` | Absent during initial private validation |

There is no application `BULLETIN_TELEGRAM_BOT_TOKEN_PARAMETER` lookup and no app SSM SDK. Reject duplicate/conflicting token entries. An absent/invalid Telegram configuration blocks Telegram only: existing email startup, queue messages, SES events and consent behavior continue. Do not add another queue consumer or change the existing `BULLETIN_EMAIL_WORKER_ENABLED`/queue settings.

ECS injects the full secret when a task starts; rotation requires new tasks/a reviewed service deployment. Fargate full-secret injection requires platform1.3.0 or later. Do not introduce a new VPC endpoint/network/CDN change solely for this feature without reviewing actual connectivity and scope. [AWS secret injection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-ssm-paramstore.html)

## Private validation and rollback

First verify persisted Telegram mode `test`/revision0, no unfinished job, a prepared immutable PDF and the explicit test target. Metadata verification must confirm the expected bot, exact numeric private channel, group or supergroup, bot administrator/creator rights and no public username/active usernames, with positive member count at most2. Channels additionally require the administrator permission to post messages; groups do not expose that channel-specific permission. Configured real channel details alone never switch mode. Do not post to `@alhaperek` during private validation or resolve a mutable username on each send.

The owner-approved test destination is the private Test_Bulletin supergroup. Its numeric identifier stays in server-only configuration. The real destination remains a channel whose current public username must be @alhaperek; a real group or supergroup is rejected. Verification keeps the exact chat type privately for the upload, and the send acknowledgement must match both its numeric ID and verified type. A changed type is an uncertain result and cannot trigger an automatic retry.

After explicit test-post authorization, enqueue once using a stable UUID and captured test revision through the authenticated admin API. Sending uploads the saved PDF bytes directly; it does not publish a new S3 URL or render/prepare content. The existing single SQS dispatcher claims each job once. Preserve the returned Telegram message/file IDs and final status; a successful provider response confirms posting, not that a person read it. On timeout/malformed/ambiguous result, stop and inspect the durable uncertain attempt; never create another key to retry it automatically.

Rollback removes only the added Telegram secret reference/nonsecret environment from a clone of the latest task and redeploys that reviewed task. Retain the two database tables and audit rows; do not drop history or reset uncertain attempts. Retain the operator's SecureString for controlled rotation/recovery. If removing the optional IAM stack, first remove every task reference to the token and finish the ECS rollout, then remove only its exact inline policy; preserve all SES/base execution permissions. A binary rollback uses the normal release pipeline. Do not roll the entire service back to an old task that would remove later unrelated settings.
