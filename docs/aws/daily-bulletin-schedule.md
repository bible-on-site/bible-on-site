# Scheduled daily bulletin

EventBridge Scheduler enqueues the internal trigger at 10:00 in `Asia/Jerusalem`, Sunday-Thursday. AWS handles daylight-saving changes. The calendar preserves the legacy Israeli rules: skip work-prohibited holidays; prepare a weekday holiday on the preceding study day, including both days of Rosh Hashana when applicable. Friday/Saturday never create another bulletin.

The existing admin SQS worker fans out one generation receipt per target date. Each receipt calls the existing immutable preparation path, which chooses the chapter from the database's persisted 929 mapping and an eligible distributable article, then saves both PDF and email HTML. No content is populated from source files. Generation, channel jobs and native SES events use the same queue; no public scheduler endpoint or second consumer is introduced.

## Audience and duplicate protection

The scheduled rollout requires persisted email `test`, Telegram `real` and WhatsApp `real`. It never changes audience settings. A mismatch stops before preparation; operators retain the authenticated revision-checked admin controls. Email consent, unsubscribe and suppression checks remain in the original SES delivery path.

Each date/channel receives a deterministic UUID. SQS redelivery and overlapping tasks reuse that key, while the real Telegram/WhatsApp paths retain their date-scoped `production` keys and historic delivery ledger. Failed or uncertain provider uploads are never reset or repeated automatically. A partial enqueue failure leaves the generation receipt for normal queue redrive, while independently successful channel jobs remain valid. An old/future timestamp or target date outside the validated calendar is rejected. Messages that exhaust the existing receive limit reach the existing worker DLQ for operator inspection.

One generation receipt renders one date, preserving the existing 120-second visibility and shutdown settings when holidays require several bulletins. No existing timeout, retry limit, outbox budget or test deadline is increased.

## Deployment

1. Deploy the merged additive Telegram and WhatsApp migrations, exact token-injection policies and current renderer/admin release. Verify the AWS account, region, existing role and current service before writes. Preserve every unrelated ECS field and the current `:latest` image contract.
2. Store provider credentials only as the previously reviewed SecureStrings. Inject them through ECS `secrets`; configure the verified numeric Telegram destinations and distinct real/private-test WhatsApp groups. Verify the live provider identities and membership, then validate saved PDF delivery privately.
3. Keep email on its existing test list. Use the authenticated admin API to select the verified real Telegram channel and real WhatsApp group with current revisions and explicit real confirmation. Do not alter legacy email consent or restore unsubscribed test addresses.
4. Deploy `cloudformation/daily-bulletin-schedule.yaml` as `bible-on-site-daily-bulletin-schedule`. The template starts **DISABLED**. Its new role trusts only Scheduler from this account and schedule group, and can only send to the exact existing worker queue and its DLQ. It grants no database, provider-token, network, DNS/CDN or public asset access.
5. After this PR's specific AWS approval, green CI, a stable released admin image and successful live validation, set `BULLETIN_SCHEDULE_ENABLED=true` on a clone of the current task. Enable the schedule through its `ScheduleState` parameter. Confirm the cron, timezone, next study dates, persisted audiences and healthy worker.

The initial requested ordinary runs are Thursday 2026-10-29 and Sunday 2026-11-01 at 10:00 Jerusalem. If release/approval finishes after a scheduled time, report that missed run; do not fabricate a successful send or silently backdate a trigger. Inspect the immutable date and its channel jobs before authorizing an explicit catch-up.

## Verification and rollback

Check the scheduler state/target, healthy ECS tasks and their actual image digests, immutable bulletin chapter/article/PDF hashes, per-channel durable jobs/provider IDs, SES events and the worker DLQ. An accepted WhatsApp upload must be reconciled to its documented journal status; acceptance alone is not delivery. Never infer delivery to every group member from a provider acknowledgement.

Disable the schedule and remove only `BULLETIN_SCHEDULE_ENABLED` from a clone of the latest task to stop automatic generation. Existing queued sends may already have been claimed; inspect their durable status rather than deleting history or creating new keys. Keep immutable artifacts, subscription/consent records, provider IDs and uncertain jobs. Revert the scheduler implementation through the normal release pipeline if needed; preserve later unrelated task settings, existing public URLs and assets.

[AWS schedule types and timezones](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html) and [scheduled-time payload context](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-schedule-context-attributes.html).
