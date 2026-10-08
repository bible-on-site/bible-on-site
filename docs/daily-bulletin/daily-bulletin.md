# Daily bulletin revival

## Implemented

The admin `/bulletins` page prepares a bulletin for a selected civil date in Jerusalem. It resolves the chapter from the database 929 calendar, chooses one approved article, and includes chapter dedications from the database. Friday and Saturday previews use Thursday's study chapter. Dates outside the persisted calendar are rejected rather than silently choosing another chapter.

Articles have a `distributable` flag, editable as **מאושר לפרסום בעלון היומי** in the article editor. Existing and new articles default to unapproved. Preparing a date with no approved article produces a scripture-only bulletin.

The Rust `web/bulletin` service renders email HTML and PDF from the same article snapshot. Article HTML is sanitized and relative links are resolved against the public website. Scripture retains cantillation and biblical maqaf. The PDF contains the Hebrew date, dedications, chapter, and selected article. Existing on-demand book and chapter downloads continue using their original endpoint and request format.

Preparation stores the input snapshot, email HTML, PDF bytes, subject, source, and filename in `tanah_daily_bulletin`, with one record per date. Repeated or concurrent preparation returns the first saved result. Later article edits do not change a prepared bulletin. All three channel records are created in the same transaction in `tanah_daily_bulletin_delivery`. This stage prepares previews only and has no sending action or scheduled trigger.

## Database deployment

`data/mysql/tanah_daily_bulletin_upgrade.sql` is an additive, repeatable migration in the normal data deployment manifest. It retains article eligibility, prepared bulletins, and delivery records. It intentionally builds table DDL with `CONCAT`: the existing database deployment Lambda rewrites literal `CREATE TABLE` statements into destructive rebuilds, even with `IF NOT EXISTS`.

The preprocessor also rewrites table/view creation keywords inside SQL comments. The migration avoids those phrases in its comments, and the deployment validator rejects them. Validate both preprocessing and execution against disposable MySQL before changing this migration.

The fresh local/CI population path also applies the upgrade after creating the dynamic schema. Never rebuild production dynamic tables to apply this change.

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

- Restore Smoove list management and sending, verify the intended list, and preserve unsubscribe behavior.
- Restore Telegram document posting and verify bot access to the channel.
- Recover or replace the separate WhatsApp service and verify group delivery.
- Implement channel claims using the stored lease fields, provider IDs, retry tracking, and an explicit uncertain state for ambiguous provider outcomes.
- Add EventBridge scheduling in `Asia/Jerusalem`, holiday advance sends, and calendar regression tests.
- Add failure monitoring and admin controls for reviewing/rebuilding unsent bulletins and retrying failed delivery.
- Restore public email signup and channel/group join links.

The older sequence diagram is a target sketch, not deployed behavior. In particular its Smoove PDF-generation step does not match the legacy code or the current Rust renderer.
