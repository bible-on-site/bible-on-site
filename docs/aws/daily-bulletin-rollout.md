# Original-cohort email rollout (#3382)

The bulletin email list grows from the test audience to the original subscriber list by admitting **one additional eligible original subscriber per Asia/Jerusalem calendar day**. This is an email-only, cumulative expansion: each admitted subscriber stays active for every later ordinary bulletin. It is not a rotating daily recipient and not a bulk activation of the original list. Telegram and WhatsApp rollout are unchanged, and the global email audience stays `test` throughout.

## Cohort source and consent

The authoritative cohort is the legacy subscriber import recorded under [the SES rollout checkpoints](daily-bulletin-ses.md#verified-rollout-checkpoints-2026-10-28): 52 legacy contacts imported as `pending` consent, plus the known opt-outs preserved as `unsubscribed`/`bounced`/`complained`. Members join `tanah_daily_bulletin_email_cohort` only through the reviewed private plan described below — never inferred from current `pending` rows, so later direct signups are not silently promoted into the original cohort.

Admission never fabricates consent. A member activates only when the subscriber row is still `pending` and SES proves the contact is subscribed to the `real` topic; the same guarded write flips consent to `confirmed`. Already-`confirmed` members (e.g. a direct signup ahead of their turn) are recorded `admitted` without consuming a day's reservation. `unsubscribed`, `bounced` and `complained` members are permanently `excluded`; a member whose consent lapses mid-flight is excluded and the local consent row is never re-activated. Recipient addresses, the source snapshot and generated plans stay outside source control.

## Durable state

`data/mysql/tanah_daily_bulletin_rollout_upgrade.sql` is an additive, repeatable migration in the normal manifest. It adds three tables and preserves all existing consent and delivery records:

- `tanah_daily_bulletin_email_rollout` — singleton control row: cohort name, `disabled`/`running`/`paused`/`completed`, revision for optimistic operator control, start/completion timestamps and the last sweep error.
- `tanah_daily_bulletin_email_cohort` — stable membership keyed `(cohort, subscriber_id)` with a unique deterministic `position` equal to the original signup/import order, `pending`/`admitted`/`excluded`, admission date and exclusion reason.
- `tanah_daily_bulletin_email_admission` — one row per `(cohort, local_date)`. The row itself is the atomic daily reservation: any worker, SQS redelivery, deploy overlap or operator re-run on the same Jerusalem date sees the existing row and cannot activate a second subscriber. `reserved` is the in-flight claim with its recorded member; `admitted` is terminal; `exhausted` means no eligible member remained that day; `lapsed` records a past reservation whose member became ineligible.

The migration builds its DDL with `CONCAT`/`PREPARE` like the other bulletin upgrades, because the deployment Lambda rewrites literal `CREATE TABLE` statements, and its comments avoid `'` and `;` so the legacy statement splitter stays safe. The native MySQL test applies it through the same extracted parser helpers.

## Daily admission

The existing email worker's periodic outbox sweep calls `reconcileRolloutAdmission`. While the rollout is `running` it claims the current Jerusalem date inside one transaction that locks the rollout row, inserts the day's reservation, normalizes cohort status against current consent, and selects the lowest-position still-pending member. That member is then reconciled: SES `real`-topic subscription is verified first, then a locked transaction flips `pending → confirmed`, stamps the cohort row `admitted` with the day's date and concludes the reservation — or excludes the member and clears the same reservation for the next eligible member, bounded per pass. An uncertain provider outcome keeps the recorded member for the next sweep; an `opted_out` answer updates local consent first, then releases the reservation.

Older `reserved` rows settle before each day's new claim, and only for their already-recorded member — a missed day is never caught up and no past date activates a substitute. A same-day reservation interrupted mid-flight resumes the same recorded member rather than leaking a second activation. When no eligible member remains the reservation is recorded `exhausted` and the rollout completes itself.

## Limited-cohort delivery

While the rollout is `running`, `paused` or `completed`, the scheduled bulletin enqueues a second durable `real` email job licensed by the rollout row rather than the global audience. It reaches exactly the `confirmed` real subscribers — the admitted cohort plus direct signups — and claims the existing `tanah_daily_bulletin_delivery` email ledger once, so the production history stays singular and idempotent across redeliveries. The ordinary `test` job continues unchanged; Telegram and WhatsApp paths are untouched.

Every delivery safeguard still applies: the job freezes audience and settings revision, `reserveSendSlot` locks the settings and rollout rows `FOR UPDATE`, re-checks confirmed consent and paces the account rate, `processEmailRecipient` re-validates before dispatch, and SES `ListManagementOptions` carries the `real` topic so its native preference page unsubscribes the right topic. Provider events keep writing local suppression monotonically; an admitted member who unsubscribes simply stops matching `confirmed` and is never re-activated.

Pausing stops only new admissions — already admitted subscribers keep receiving bulletins. Disabling is the full rollback: no admissions and no cohort delivery, with every consent and audit record retained. The admin `/bulletins` panel shows state, admitted/remaining/excluded counts, today's reservation and the limited-cohort job status, with revision-checked enable/pause/resume/disable controls. No recipient address is rendered.

## Private enrollment operation

1. Deploy the migration through the normal reviewed schema-only database path; repeat it and verify retained data before enabling anything.
2. Export the authoritative original list in original signup/import order and reconcile it privately with the subscriber table: every entry needs the subscriber `id`, lowercase address and current consent status. The snapshot stays outside the repository.
3. From `web/admin`, run `bun run scripts/plan-bulletin-rollout-cohort.mts --snapshot private-cohort.json --output private-output-directory`. The planner validates and orders the snapshot, prints only aggregate counts, and writes `cohort-plan.json` plus `enroll.sql` into the private directory.
4. Review the plan, then apply `enroll.sql` through the reviewed database operation path. It locks the referenced subscriber rows `FOR UPDATE`, verifies id/audience/address/consent still match the snapshot exactly, and inserts the whole cohort in one transaction; drift or a repeated operation aborts the transaction. Store the snapshot, plan and generated SQL privately.
5. Enable the rollout from the admin panel. The next worker sweep admits the first member; each later Jerusalem day admits one more.

## Deferred production steps

This change ships disabled: the rollout row starts `disabled`, cohort membership is empty, and no scheduled or manual path can produce a limited-cohort job. The deferred production work, after the reviewed deployment:

1. Apply `tanah_daily_bulletin_rollout_upgrade.sql` through the normal data-deploy route and repeat it once.
2. Run the private cohort enrollment above; verify `total`, per-status counts and the exact member order against the reconciled snapshot.
3. Confirm the email worker is running, then enable the rollout in the admin panel and watch the first daily admission's durable rows — admission `admitted`, cohort `admitted`, subscriber `confirmed` — before assuming the ramp is healthy.
4. Observe bounce/complaint/unsubscribe handling on the limited `real` job before any later decision to widen the audience.

## Rollback

Disable the rollout from the admin panel at any time: new admissions stop and the limited `real` job is suppressed while existing test sends continue. For a full retreat, `BULLETIN_EMAIL_WORKER_ENABLED=false` stops the sweep itself; retain cohort, admission and consent history and the existing queues. A disabled rollout can be re-enabled without losing progress, since admitted members remain `admitted` in durable state.
