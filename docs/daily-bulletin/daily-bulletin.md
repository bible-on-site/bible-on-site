# Daily bulletin revival

## Implemented

The admin `/bulletins` page prepares a bulletin for a selected civil date in Jerusalem. It resolves the chapter from the database 929 calendar, chooses one approved article, and includes chapter dedications from the database. Friday and Saturday previews use Thursday's study chapter. Dates outside the persisted calendar are rejected rather than silently choosing another chapter.

Articles have a `distributable` flag, editable as **מאושר לפרסום בעלון היומי** in the article editor. Existing and new articles default to unapproved. Preparing a date with no approved article produces a scripture-only bulletin.

This flag controls inclusion in the daily bulletin only. It must not filter public website articles, author listings, sitemaps, or public search. Public articles belong to canonical chapters 1-929; invalid chapter references are excluded independently of bulletin approval.

The Rust `web/bulletin` service renders email HTML and PDF from the same article snapshot. Article HTML is sanitized and relative links are resolved against the public website. Scripture retains cantillation and biblical maqaf. The PDF contains the Hebrew date, dedications, chapter, and selected article. Existing on-demand book and chapter downloads continue using their original endpoint and request format.

The daily email uses the original native/PDF wordmark, a compact chapter/date subheader, justified scripture with small verse labels, and a justified article section with its final line aligned right. Its contact/footer slot keeps the website's published email, phone, WhatsApp and Telegram channels, with their original contact icons, inside the same card as the reading content. Only the SES transport fills the unsubscribe slot. Existing saved snapshots retain their original HTML; newly prepared bulletins use the current design. Duplicate article headings are removed only when they repeat the supplied article title.

Preparation stores the input snapshot, email HTML, PDF bytes, subject, source, and filename in `tanah_daily_bulletin`, with one record per date. Repeated or concurrent preparation returns the first saved result. Later article edits do not change a prepared bulletin. All three production channel records are created in the same transaction in `tanah_daily_bulletin_delivery`. Email has a separate audience setting and per-recipient audit. There is no scheduled trigger.

## SES email delivery

For a saved bulletin, the admin sends its stored HTML to the selected audience. The persisted setting defaults to `test`; deployment does not activate `real`. The admin selector is backed by an authenticated API, revision checks and explicit real-audience confirmation. A request carries the audience and revision visible when it was submitted, so a stale test tab cannot send to real subscribers. Real mode additionally requires SES production access and at least one confirmed subscriber. See the [SES deployment runbook](../aws/daily-bulletin-ses.md) for infrastructure, runtime configuration and rollback.

The database owns subscriber consent and audience membership. The SES contact list has separate `test` and `real` topics, both defaulting to opt-out. Only explicitly confirmed subscribers are queued. Legacy eligibility flags are imported as pending consent, never confirmed. Known opt-outs are retained. The subscriber administration API records the source of consent when confirming a subscriber and supports global removal. Recipient addresses and import files stay outside source control.

Each send creates a durable job and recipient records before publishing work to SQS. The admin service processes one recipient per SES request, at a globally reserved rate. Atomic claims prevent duplicate sends after repeated queue deliveries. Production has one idempotent job per bulletin date. Tests use a request UUID and require an explicit new-test action after a terminal result. An ambiguous provider response is recorded as uncertain and is never retried automatically. Tests do not update the production email channel.

SES adds native unsubscribe controls using Easy DKIM and `ListManagementOptions`. The visible Hebrew footer includes the publisher, monitored contact email and managed unsubscribe link. Each dispatch rechecks the native contact preference and local consent. Subscription events, permanent bounces and complaints update local suppression. Event processing is correlated to the attempt and handles duplicate or out-of-order notifications. API acceptance is shown separately from confirmed delivery. The optional physical-address field is not a readiness gate; no claim of universal legal compliance follows from enabling unsubscribe.

The additive migration creates settings, subscribers, jobs and per-recipient history. Apply and verify it before enabling the worker. Disable `BULLETIN_EMAIL_WORKER_ENABLED` and restore the preceding admin task definition to roll back execution; retain subscriber preferences, queues and audit data. The stack adds DKIM records without changing existing public routes. Smoove is no longer the delivery provider; its quota-exhausted partial list is unused and no Smoove campaign was sent during this migration.

## WhatsApp group delivery

The [GREEN-API runbook](../aws/daily-bulletin-whatsapp.md) covers the additive schema, cached connection checks, secret injection and private validation. The admin has an authenticated revision-checked test/real selector; test is the default and the real group remains unconfigured. Saved PDF bytes are posted once, with a durable job and immutable target/membership/hash. Accepted uploads remain visibly distinct from journal-confirmed sending. Uncertain outcomes never trigger another upload. Ordinary admin reads make no provider calls, and one existing SQS worker handles email and WhatsApp.

The new controls have actual desktop/mobile [before and after captures](screenshots/README.md). Local implementation and native database validation do not establish production deployment or successful provider delivery. The public join carousel and native-app counterpart ([issue #2806](https://github.com/bible-on-site/bible-on-site/issues/2806)) follow channel validation and must expose only public join links.

## Database deployment

`data/mysql/tanah_daily_bulletin_upgrade.sql` is an additive, repeatable migration in the normal data deployment manifest. It retains article eligibility, prepared bulletins, and delivery records. It intentionally builds table DDL with `CONCAT`: the existing database deployment Lambda rewrites literal `CREATE TABLE` statements into destructive rebuilds, even with `IF NOT EXISTS`.

The preprocessor also rewrites table/view creation keywords inside SQL comments. The migration avoids those phrases in its comments, and the deployment validator rejects them. Validate both preprocessing and execution against disposable MySQL before changing this migration.

The fresh local/CI population path also applies the upgrade after creating the dynamic schema. Never rebuild production dynamic tables to apply this change.

The release detector routes this migration and its db-populator preservation-test companion through the manual schema-only path. Unrelated content/bootstrap changes still require their normal deployment route. Run only this reviewed migration through the existing database Lambda, then repeat it and verify retained data. Do not invoke the complete data-deployment manifest for this rollout.

## Preview runtime

- Production admin invokes `bible-on-site-bulletin` in `il-central-1` using its ECS task role. `AdminBulletinPreview` in `ecs-services.yaml` grants permission for that function only. `BULLETIN_LAMBDA_NAME` and `AWS_REGION` can override the defaults.
- Existing manually provisioned deployments use `adminTaskRole`; apply the same `AdminBulletinPreview` policy to the role referenced by the live admin task definition. The CloudFormation template names its managed role `bible-on-site-admin-task-role`.
- Development admin spawns the bulletin binary. Build it with `cargo build` in `web/bulletin`, or set `BULLETIN_BINARY_PATH` to an existing binary.
- The Lambda route is `POST /api/preview-daily`, using an API Gateway v2 envelope for direct invocation. The CLI equivalent is `bulletin --daily-preview`, with the same JSON input on stdin and JSON artifacts on stdout.

Input fields: `date`, `hebrewDate`, `perekId`, nullable `article` containing `id`, `title`, `author`, and `html`, plus `dedications` as a string array. Output fields: `subject`, `source`, `emailHtml`, `pdfBase64`, and `filename`.

The authenticated admin creates and reads previews. The renderer does not connect to subscriber services or send messages.

## Legacy behavior to restore

The old `tanah-back/src/cpanel/distribution` implementation sent HTML campaigns through Smoove, generated PDFs locally with `html-pdf`, posted documents through a Telegram bot, and called a separate WhatsApp server on localhost port 5000.

It ran at 11:00, 12:00, 13:00, and 14:00 Sunday through Thursday in the server's timezone. It skipped Israeli work-prohibited holidays and sent upcoming holiday chapters in advance, including the second day of Rosh Hashanah.

Its state table stored a date, Smoove campaign ID, Telegram success flag, and WhatsApp success flag. It relied on local PDF files, saved state only after the channel sequence, and did not lock concurrent runs. Those limitations must be resolved when restoring delivery.

## Remaining delivery work

- Complete final native unsubscribe and deployed-worker validation. SES production access is granted. Keep the audience set to test until the owner explicitly activates real sending and consent has been established.
- Restore Telegram document posting and verify bot access to the channel.
- Complete the GREEN-API deployment and owner-only WhatsApp group-delivery validation.
- Extend durable claims, provider IDs and ambiguous-outcome handling to Telegram and WhatsApp.
- Add EventBridge scheduling in `Asia/Jerusalem`, holiday advance sends, and calendar regression tests.
- Add failure monitoring and admin controls for reviewing/rebuilding unsent bulletins and retrying failed delivery.
- Restore public email signup and channel/group join links.

The older sequence diagram is a target sketch, not deployed behavior. In particular its Smoove PDF-generation step does not match the legacy code or the current Rust renderer.
