# WhatsApp daily bulletin: GREEN-API private validation

The admin posts the existing immutable bulletin PDF to one server-configured WhatsApp group through GREEN-API. Settings default to `test`. The real group remains unconfigured during private validation; joining links and the later admin audience switch are separate work. There is no recurring schedule in this change.

GREEN-API uses a linked WhatsApp account and is an unofficial integration. Its Developer plan currently supports three chats per month; a group counts as one chat. File sending is not charged per group member. The provider documents monthly limits of 1,000 calls each for group metadata and message-journal lookups, plus one group-metadata request per second. The integration caches verified metadata, uses a database-wide lookup lease across overlapping tasks, and budgets known-message reconciliation globally. Other use of the same instance shares the provider allowance. See [plans](https://green-api.com/en/docs/about-tariffs/), [rate limits](https://green-api.com/en/docs/api/ratelimiter/), and [unofficial integration](https://green-api.com/articles/en/unofficial-whatsapp-api-what-is-it-and-how-to-use-it/).

## Database and delivery contract

Apply only `data/mysql/tanah_daily_bulletin_whatsapp_upgrade.sql` using the reviewed manual migration path after specific AWS approval. It adds settings, cached verification and job tables. `INSERT IGNORE` seeds `test`/revision0 without resetting an existing selection. Split creation keywords preserve history through the legacy deployment rewriter. The bootstrap manifest applies the migration only for fresh local/CI databases; the release detector keeps this migration and its bootstrap preservation fixture on the manual schema-only path. Never run a full production data bootstrap to add WhatsApp.

The native suite creates and drops only a uniquely named loopback schema. It checks the actual database operations, repeated parser-processed migration preservation, atomic upload claims, global lookup leases, monthly quota contention and UTC month rollover. Run `bun run test:mysql` from `web/admin` with `BULLETIN_MYSQL_TEST_DB_URL` pointing to a loopback MySQL account that can create/drop its own schema. Normal admin CI runs this after MySQL starts. Optional paired `BULLETIN_MYSQL_LAMBDA_ZIP` and `BULLETIN_MYSQL_LAMBDA_SHA256` select a SHA-pinned downloaded deployment handler for a local parser proof.

An authenticated admin explicitly verifies the connection and target. Ordinary state reads use only the database and consume no provider allowance. Verification caches for ten minutes; a send checks the live account and group again. The private test group must contain at most the owner and the connected sender, exactly matching the pinned membership digest. Verify sender identity, membership, administrator rights and that the target is not a community or announcement group. Targets, API origins and credentials are server-owned; API requests cannot override them.

A durable job freezes instance, sender, group, membership, PDF hash, filename, caption and settings revision. The existing single SQS worker routes only the exact internal `{"kind":"whatsapp.send","jobId":"UUID"}` shape. It preserves native SES jobs/events; no second consumer or public webhook is introduced. One atomic claim precedes one upload. Missing queue publication can be repaired with the same job; an upload that may have happened is never automatically repeated. Existing legacy production-channel history prevents a second production post; test jobs leave that history intact.

GREEN-API upload acceptance is shown as accepted, separately from sent. A known returned message ID is checked in the journal after its documented two-minute lag, with at most six durable status checks and an instance-wide 1,000-per-UTC-month application budget. Unknown or exhausted outcomes require review and never cause another upload. A provider-reported sent/delivered/read result confirms transport status, not that every group member read the bulletin. See [file upload](https://green-api.com/en/docs/api/sending/SendFileByUpload/) and [message journal](https://green-api.com/en/docs/api/journals/GetMessage/).

For journal status, enable only the provider's outgoing-message-status setting (`outgoingWebhook: yes`) after reviewing the current instance settings. Preserve its webhook URL and every unrelated setting. Do not take over an existing HTTP notification queue. Host values must come from the instance console; do not infer them from the instance number. See [instance hosts](https://green-api.com/en/docs/api/recommendations/using-green-api-hosts/).

## AWS setup and compatibility

Before writes, verify account `250598594267`, region `il-central-1`, the latest stable admin task definition/image, empty pending queues, persisted test settings and no active jobs. Deploy a worker-capable admin release and the additive migration before setting runtime credentials. Preserve all SES configuration, existing environment/secrets, roles, resources, ports, networking and the `:latest` image contract. Keep `stopTimeout:120`.

Store the existing owner-approved API key only as SecureString `/bible-on-site-whatsapp-api-token` with the AWS-managed SSM key, using secure entry or an in-memory transfer. Never place it in source, chat, command arguments, logs, task `environment`, CloudFormation parameters or outputs. Provider URLs embed the key; raw requests and errors must not be logged. ECS startup injects the secret through the execution role; the application reads only its environment variable and needs no SSM SDK or permission. A different customer-managed KMS key needs separate exact-key approval.

The live execution-role policy inspected on 2026-10-28 covers database/admin/revalidation parameters and the Tanahpedia revision key, but not this exact new parameter. Review the [optional policy template](cloudformation/daily-bulletin-whatsapp.yaml): it adds only `ssm:GetParameters` for this parameter to the existing execution role. It creates no role, secret, task, queue, network or public URL. Do not broaden the shared policy. Skip the optional stack if a fresh audit proves the exact parameter already accessible.

Append this secret reference to a clone of the current admin task, retaining every existing entry:

```json
{
  "name": "BULLETIN_WHATSAPP_API_TOKEN",
  "valueFrom": "arn:aws:ssm:il-central-1:250598594267:parameter/bible-on-site-whatsapp-api-token"
}
```

Set these server-only environment variables; never use `VITE_` names:

| Variable | Initial source |
| --- | --- |
| `BULLETIN_WHATSAPP_INSTANCE_ID` | Exact owner-approved instance |
| `BULLETIN_WHATSAPP_API_URL` | Exact HTTPS API origin shown by that instance |
| `BULLETIN_WHATSAPP_MEDIA_URL` | Exact HTTPS media origin shown by that instance |
| `BULLETIN_WHATSAPP_SENDER_PHONE` | Verified site sender, digits with country code |
| `BULLETIN_WHATSAPP_TEST_GROUP_ID` | Explicit owner-only group ID, including `@g.us` |
| `BULLETIN_WHATSAPP_TEST_PARTICIPANT_DIGEST` | `sha256:` plus SHA-256 of UTF-8 JSON of sorted participant `lid || id` values |
| `BULLETIN_WHATSAPP_REAL_GROUP_ID` | Absent during private validation |

The existing SES region/account/shared-queue configuration and `BULLETIN_EMAIL_WORKER_ENABLED` remain required. Absent WhatsApp configuration disables only WhatsApp. Malformed configuration blocks WhatsApp without enabling real sending. Changing audience requires authentication, the current revision, fresh target verification and explicit real confirmation; active or uncertain jobs lock the selector across dates.

Run offline validation before a change set:

```powershell
bun test devops/daily-bulletin-infra.test.mjs
python -B -m unittest discover -s devops/deploy/data-deploy -p test_lambda_parser.py
```

Read-only template validation checks structure only:

```powershell
aws cloudformation validate-template --template-body file://docs/aws/cloudformation/daily-bulletin-whatsapp.yaml --profile AdministratorAccess-250598594267 --region il-central-1 --cli-connect-timeout 5 --cli-read-timeout 15
```

Present current PR impact and rollback and obtain specific approval before merging or making AWS changes. Prepare/review the exact change set; application CI must not auto-deploy this optional policy. Verify stable healthy tasks after rollout, then use the authenticated API to verify the private target and enqueue one reviewed saved PDF with a retained UUID. Preserve the job, provider ID, target and evidence; accepted alone is not successful validation. Do not switch the real audience or enable a schedule.

Rollback removes only added WhatsApp environment and secret references from a clone of the latest task, then completes the reviewed ECS rollout. Preserve SES and unrelated settings, all three new audit tables, provider IDs and uncertain jobs. Retain the SecureString for controlled rotation. Remove the optional exact policy only after no task references it. A binary rollback follows the normal release path; never drop history or reset a job to resend it. Public/crawled URLs, DNS/CDN, existing assets and recipient consent are unchanged.
