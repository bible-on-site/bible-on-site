# Daily bulletin delivery with Amazon SES

The [daily bulletin stack](cloudformation/daily-bulletin-ses.yaml) adds regional email delivery and subscription events to the existing admin ECS service. An admin background worker polls one standard SQS queue. The queue accepts internal send jobs and raw SES events published through SNS. There is no Lambda worker, SMTP password, dedicated IP pool, NAT gateway, new VPC, or change to existing public web routing in this stack.

SES production access is now granted in `il-central-1`, so AWS no longer requires recipient identity verification there. The application's persisted audience must remain **TEST** after deployment. Creating a `real` subscription topic or importing legacy subscribers does not authorize real-audience delivery. The later admin audience switch is a separate operator action. Do not enable a recurring bulletin schedule as part of the infrastructure rollout.

## Initial baseline inspected on 2026-10-28

| Item | Existing state |
| --- | --- |
| AWS account and SSO profile | `250598594267`, `AdministratorAccess-250598594267` |
| Application region | `il-central-1` |
| SES in Israel and Frankfurt | Healthy sandbox; production access disabled; 200 recipients per rolling 24 hours, 1 recipient/second, zero sent |
| SES identities, contact lists, configuration sets | None in either inspected region |
| Admin ECS cluster / service | `bible-on-site-cluster` / `bible-on-site-admin` |
| Admin task definition | `bible-on-site-admin:6` at inspection; clone the current live revision when deploying |
| Live task role / execution role | `adminTaskRole` / `ecsTaskExecutionRole` |
| Existing task-role inline policies | `AdminBulletinPreview`, `AdminS3Access`; no attached managed policies or SES permissions |
| Existing public `.co.il` hosted zone | `Z03490201R24I4MCQHQKG`, `xn--febl3a.co.il` |
| Existing web records | Apex A, `www` and wildcard CNAME, NS, SOA, and an existing TXT record |
| Existing root SPF / DMARC / MX | None found; this stack does not add or alter them |

SES offers its HTTPS API in Israel, but not an SMTP endpoint there. Use the AWS SDK SESv2 client in `il-central-1`, authenticated by the ECS task role. SES identities, sandbox state, quotas and contact data are regional; a Frankfurt verification does not make the identity ready in Israel. See [SES endpoints](https://docs.aws.amazon.com/general/latest/gr/ses.html) and [regional considerations](https://docs.aws.amazon.com/ses/latest/dg/regions.html).

## Resources and access

The template has these defaults:

| Parameter | Default |
| --- | --- |
| `HostedZoneId` | `Z03490201R24I4MCQHQKG` |
| `DomainName` | `xn--febl3a.co.il` |
| `FromAddress` | `bulletin@xn--febl3a.co.il` |
| `AdminTaskRoleName` | `adminTaskRole` |
| `ContactListName` | `bible-on-site-daily-bulletin` |
| `ConfigurationSetName` | `bible-on-site-daily-bulletin` |

Verify that `FromAddress` belongs to `DomainName` and that the hosted zone is that domain's authoritative public zone before executing a change set. The stack grants a scoped inline policy to the **existing task role**. It does not create or replace the role and does not change the execution role. Existing permissions and secrets must be preserved.

The domain identity uses Easy DKIM with 2048-bit keys. Exactly three CNAME records use the names and values returned by SES. Do not construct DKIM targets by appending `dkim.amazonses.com`: Israel uses a regional DKIM target. The stack also adds a `_dmarc` TXT policy with `p=none` and relaxed alignment, after confirming no existing policy is present. It requests no rejection or quarantine. Existing apex A, `www`, wildcard, root TXT, SPF and MX records remain outside this stack. Using the apex domain identity also avoids introducing a custom MAIL FROM subdomain that changes existing wildcard DNS behavior. See [email identity outputs](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ses-emailidentity.html) and [SES DMARC authentication](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html).

The configuration set requires TLS and publishes `SEND`, `DELIVERY`, `BOUNCE`, `COMPLAINT`, `REJECT`, `RENDERING_FAILURE` and `SUBSCRIPTION` events. Its standard SNS topic accepts SES publishing only for this account and this exact configuration-set ARN. The SQS resource policy grants SNS delivery only from that topic and denies insecure transport. The task role can enqueue and process messages through its separate identity policy. See [SES SNS publishing permissions](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html).

The shared queue and dead-letter queue use SQS-managed encryption, with no customer-managed KMS key or extra KMS grants. The worker queue has a 120-second visibility timeout, 20-second long polling, four-day retention and redrive after three receives. The DLQ retains messages for 14 days and accepts redrive only from this worker queue. For a standard queue, time spent in the source queue counts toward DLQ expiry; investigate failures promptly.

Runtime permissions are limited to:

- `sqs:SendMessage`, `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility` and `sqs:GetQueueAttributes` on the shared worker queue only. Batch APIs use the corresponding base IAM action, so `SendMessageBatch` requires `sqs:SendMessage`.
- `ses:SendEmail` on the exact identity and configuration-set ARNs, with the exact `ses:FromAddress` condition.
- `ses:CreateContact`, `ses:UpdateContact` and `ses:GetContact` on the one contact-list ARN.
- `ses:GetEmailIdentity` on the identity and `ses:GetAccount` on `*` for readiness checks. `GetAccount` has no resource-scoped ARN.

The runtime receives no Route 53 writes, IAM writes, SES identity/list administration, SES wildcard action, queue purge/deletion, DLQ consumption, or SMTP credentials. Operator redrive or DLQ inspection uses separate privileged access. See [SQS API permissions](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-api-permissions-reference.html) and [SES IAM actions and resource types](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sesv2.html).

## Subscription and worker contracts

SES supports one contact list per account. This stack creates one list with `test` and `real` topics, both defaulting to `OPT_OUT`. If a list already exists when deploying, stop and reconcile its ownership rather than creating a competing list or overwriting preferences. Provision test-topic opt-ins only for explicitly authorized recipients and preserve subsequent opt-outs; keep their addresses in private configuration or database records, never in the template or runbook. Legacy import must preserve known opt-outs and must not subscribe those addresses to `test`. See [SES list management](https://docs.aws.amazon.com/ses/latest/dg/sending-email-list-management.html).

Send one recipient per SES API request. Pass the contact-list and selected topic through `ListManagementOptions`, include `{{amazonSESUnsubscribeUrl}}` in the HTML, and use UTF-8 with the bulletin's RTL markup. Easy DKIM and single-recipient delivery allow SES to add its native unsubscribe controls. Check current contact preferences before dispatch; never reset an unsubscribe by blindly upserting `OPT_IN`. See [SES subscription management](https://docs.aws.amazon.com/ses/latest/dg/sending-email-subscription-management.html).

The queue carries two distinct JSON bodies:

```json
{"kind":"send","recipientId":123}
```

This internal job refers to a durable database recipient-delivery record. Resolve its bulletin, audience, destination and current preferences from the database; do not trust an email address or audience supplied in a queue body.

The other body is the raw SES event object, including `eventType` and `mail.messageId`. `RawMessageDelivery: true` removes the SNS envelope, so do not expect an outer `Message` string or SNS signature fields. The trusted queue/topic policies provide the transport boundary. The application still validates event shape, account, source identity and correlation to a known delivery. See [SES event contents](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html).

Both paths must tolerate duplicate and out-of-order messages. Atomically claim the database delivery before sending, retain SES message IDs, process events idempotently, and do not let a late `SEND` event erase a bounce, complaint or unsubscribe. Delete a queue message only after the durable state change succeeds. An accepted SES API request is not proof of inbox delivery. A timeout or task shutdown after the request may leave an uncertain send: reconcile it with persisted IDs and events instead of automatically sending the same email again. The 120-second visibility timeout is not a duplicate-send guarantee. Keep request handling below that timeout or extend visibility while safely processing. Check every partial failure returned by `SendMessageBatch`.

Sending quotas apply across the account in each region. Pace sends against the current SES quota across overlapping ECS tasks, including rolling deployments; one loop per process does not provide a global rate limit. The initial sandbox allowed 200 recipients per rolling 24 hours and one recipient/second; production access is now granted in `il-central-1`. Use long polling and a finite SDK timeout, handle shutdown cleanly, and keep readiness failures from crashing the admin HTTP service.

## Validate and deploy

Run from the repository root with the existing SSO profile. The validation command reads the local template and does not create resources:

```powershell
$env:AWS_MAX_ATTEMPTS = '1'
aws cloudformation validate-template --template-body file://docs/aws/cloudformation/daily-bulletin-ses.yaml --profile AdministratorAccess-250598594267 --region il-central-1 --cli-connect-timeout 5 --cli-read-timeout 15
```

CloudFormation validation checks template structure, not identity readiness, delivery behavior, all IAM semantics, or live DNS compatibility. Review the change set before execution. It should add the new resources, three DKIM records and the non-enforcing `_dmarc` policy; no existing web or mail-routing record should change. Stop if the domain already has a DMARC policy and reconcile ownership first. Validation reports `CAPABILITY_IAM` for the inline policy attached to the existing role:

Run the offline policy regression before deployment:

```powershell
bun test devops/daily-bulletin-infra.test.mjs
```

The worker queue and DLQ each need a separate queue policy whose statements name only that queue's ARN. SQS rejects multi-resource statements even when CloudFormation template validation passes. The regression parses this template and checks that service constraint, the SNS publishing boundary and TLS denial on both queues.

```powershell
aws cloudformation deploy --template-file docs/aws/cloudformation/daily-bulletin-ses.yaml --stack-name bible-on-site-daily-bulletin-ses --capabilities CAPABILITY_IAM --no-execute-changeset --profile AdministratorAccess-250598594267 --region il-central-1 --cli-connect-timeout 5 --cli-read-timeout 15
```

After authorized execution, collect stack outputs and confirm the identity's verification status, DKIM status, account sandbox flag, queue encryption/redrive settings, SNS subscription and event destination. Stack completion alone does not prove DKIM verification. The stack outputs the queue URL/ARN, DLQ URL/ARN, SNS topic ARN, region, From/domain, contact-list/configuration-set names, and all three DKIM name/value pairs.

Deploy the worker-capable admin image before enabling the worker. Clone the **current** live admin task definition, retaining all existing environment variables, secrets, ports, logging, resource limits and role ARNs; append these settings:

| Environment variable | Value |
| --- | --- |
| `BULLETIN_SES_REGION` | `SesRegion` output (`il-central-1`) |
| `BULLETIN_SES_FROM` | `FromAddress` output |
| `BULLETIN_SES_REPLY_TO` | Private, operator-configured reply address |
| `BULLETIN_SES_SENDER_NAME` | Operator-configured brand display name |
| `BULLETIN_SES_CONTACT_LIST` | `ContactListName` output |
| `BULLETIN_SES_CONFIGURATION_SET` | `ConfigurationSetName` output; required on every send |
| `BULLETIN_EMAIL_QUEUE_URL` | `WorkerQueueUrl` output |
| `BULLETIN_SES_ACCOUNT_ID` | `250598594267` |
| `BULLETIN_EMAIL_WORKER_ENABLED` | `true` only after the worker-capable image is deployed |

The transport's physical contact address field is optional and is not a readiness gate. Keep private addresses out of source and template parameters. Preserve the application TEST audience. Register the cloned task definition and update only `bible-on-site-admin`. Keep a copy of the previous task definition ARN and running image digest for rollback. This stack intentionally does not manage the ECS service or task definition.

Set the admin container's `stopTimeout` to 120 seconds in that cloned task definition. The current task omitted it and therefore used Fargate's 30-second default. The worker cancels queue polling on shutdown and lets a claimed SES request, database update and queue acknowledgment finish; their combined bounded network calls can exceed 30 seconds. Keep the existing image-tag deployment contract so subsequent ECR `latest` events continue rolling the service. Preserve CPU, memory, desired count, roles, secrets and network settings. See [ECS container stop timeout](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html).

If deploying in a region or account still in the SES sandbox, recipient identities must be verified as well as the domain sender. An operator initiates recipient identity verification and each mailbox owner follows the verification email link; a simulator address can validate delivery plumbing beforehand. This template does not send verification emails or request production access. Production access is already granted in `il-central-1`, so recipient identity verification is no longer required there. This does not change the application's TEST gate or override an unsubscribe. See [moving out of the sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

Before considering rollout complete, verify TEST remains selected; send only the explicitly approved test bulletin; confirm each recipient's separate delivery/event record; check rendered Hebrew/RTL and unsubscribe handling; and verify queue and DLQ health. Do not activate `real` merely to test. Do not log message bodies, subscriber addresses, verification tokens or credentials.

## Verified rollout checkpoints (2026-10-28)

- Stack `bible-on-site-daily-bulletin-ses` reached `CREATE_COMPLETE`. Domain verification and Easy DKIM are `SUCCESS` with `AWS_SES` signing and 2048-bit keys.
- AWS granted SES production access after review. This removes AWS recipient-verification requirements; it does not activate the real audience.
- The reviewed live database handler retained its existing code hash and credential contract. Only the additive bulletin migration was applied, then repeated. Assertions verified unchanged article, approval, prepared-bulletin and channel-history counts.
- The database imported 52 legacy contacts without confirmed consent and two explicitly authorized test subscriptions. The owner authorized a third mailbox for a repeated unsubscribe test. Two test mailboxes subsequently unsubscribed: SES, native subscription-event processing and the production database all confirmed suppression. One test mailbox remains eligible; zero real subscribers are confirmed, and the persisted audience remains test. No production email job was created by provisioning.
- An isolated local database exercised the real enqueue/worker/provider/event path using an actual Rust-rendered bulletin. SES confirmed two separate deliveries. No legacy subscriber was sent an email. The DLQ remained empty.
- The live admin initially used task definition `bible-on-site-admin:6`. Worker-capable application deployment and runtime enablement must follow the approved PR and the configuration-preserving procedure above.
- A reviewed update added only the missing non-enforcing `_dmarc` record. Easy DKIM provides domain alignment; no custom MAIL FROM, root SPF, MX or web-routing changes were introduced.
- The exact original project JPEG, four website-derived PNG contact icons and a project-authored globe icon were published under new content-hashed keys in the existing public assets bucket. All six regional S3 HTTPS responses and SHA-256 values were verified. Existing objects were not replaced. Source files, provenance and regeneration instructions live in `web/bulletin/assets/email/`; retain these public URLs for already delivered emails during rollback.

Keep native unsubscribe and received-message validation separate from an SES delivery event: delivery confirms acceptance by the recipient's mail server, not its displayed headers or content. Both received test versions had the managed unsubscribe headers and passed SPF/DKIM. The downloaded revised message also confirmed that DKIM covered both unsubscribe headers. It predated the DMARC record. The owner confirmed Gmail's control was visible again on the later test, and a second real opt-out was independently verified. Compare received headers when diagnosing a missing Gmail control; [Google's eligibility checks](https://support.google.com/mail/answer/14229414) mean its top-of-message control is not guaranteed merely by adding headers. Do not add conflicting manual headers over SES management. Record deployed-worker checks before declaring rollout complete.

## Rollback and retirement

1. Disable the background worker and force the persisted audience to TEST. Stop new enqueues, preserve contact preferences and inspect outstanding jobs. Do not purge queues or blindly redrive uncertain send jobs.
2. Restore the previous admin task definition/image if needed. Retain its original roles, environment and secrets. The website and API services do not need a rollout.
3. Remove only the new `bible-on-site-daily-bulletin-runtime` policy if revoking runtime access. Preserve `AdminBulletinPreview`, `AdminS3Access` and the execution-role policies.
4. Keep database audit records and subscriber preferences. The established stack's contact list and queues are retained on deletion or replacement; initial-create rollback may remove them. Retained resources need deliberate reconciliation or import before recreating the same names.
5. If abandoning SES, export any required private operational history first, then retire the new event subscription, destination, topic, configuration set and identity deliberately. Remove only the stack-owned DKIM and DMARC records after verifying their current ownership and other mail dependencies. Handle retained contact/queue resources explicitly after their useful retention period. Retain image URLs referenced by delivered messages. Do not delete or modify apex A, `www`, wildcard, existing root TXT, NS, SOA or other mail records.

Removing DKIM/identity resources stops sending authentication; it does not change public website URLs. Do not delete a live identity or contact list merely to undo an application deployment.
