# Canonical study calendar repair

The MySQL exporter previously stored an approximation (`Hebrew year - 3761`, month clamped to 12, day clamped to 28) instead of converting the Hebrew date. That produced duplicate dates, gaps and incorrect chapter lookup. The existing `hebdate` values agree with the website's canonical calendar and remain the source of truth.

The exporter now uses fallible ICU conversion, handles both Adar months, preserves days 29/30 and rejects invalid input before replacing an existing export. The checked-in bootstrap changes only its 3,716 Gregorian date literals. Its Hebrew dates, perek/cycle identities, star-rise times and all other content are unchanged.

Production repair is a manual date-only database operation. CI still validates data changes; the narrow converter/fixture combination does not trigger a full production bootstrap. Unrelated data or perushim changes retain their existing deployment routing.

## Prepare and validate

Capture a fresh authenticated, TLS-verified, read-only database snapshot containing `calendarRows` with exactly `perek_id`, `cycle`, `date`, `hebdate` and `star_rise`. The operator must verify its account/database, invocation/code identity and actual row count. The `readonly`/`tlsVerified` fields describe that evidence; hand-authored flags are not evidence. Preserve the snapshot and generated rollback privately.

With the production snapshot's reviewed row count:

```powershell
node devops/study-calendar-repair.mjs C:\ABSOLUTE\verified-snapshot.json C:\ABSOLUTE\calendar-repair.sql 3716
node --test devops/study-calendar-repair.test.mjs
```

The planner builds exact Gregorian dates with ICU/Intl and generates forward SQL, an exact reverse SQL file and a hash-bound plan. Cross-check every date against the corrected Rust export. Do not infer dates from the old Gregorian column or clamp invalid canonical input.

The native proof requires the admin package's `mysql2` dependency and a loopback-only account with permission to create/drop its own uniquely named schema. Supply credentials through the environment without printing them:

```powershell
node --test devops/study-calendar-repair.mysql.test.mjs
```

Set `BULLETIN_CALENDAR_TEST_DB_URL` for this optional native proof. It refuses non-loopback hosts and never touches the operator's named database. It verifies date-only changes, unaffected article/consent/provider data, idempotent replay, exact rollback and rejection of changed dates, Hebrew dates, star times, added rows and missing rows. Before production, also execute the full reviewed snapshot through the actual deployed SQL parser against an owned fixture. MySQL 8.4 enforces the temporary CHECK guards; prepared `SIGNAL` is unsupported and is not used.

## Apply and verify

Use only the generated forward SQL through the existing reviewed database-deployment path. Pin its SHA256, deployed Lambda code hash, target account/database and exact owned S3 key; confirm a fresh production snapshot still matches the plan. Keep the bulletin schedule disabled and check that no generation/send is in flight during repair. Never invoke the normal all-table bootstrap for this repair.

The SQL locks every source row, verifies the complete row count and retained values, changes only `tanah_perek_date.date`, checks the affected count and full corrected mapping, then commits. Any mismatch aborts before a persistent change; the deployment connection must roll back/close on error. Replaying an already applied repair is idempotent. The generated comment header deliberately contains no semicolon because the deployed parser splits SQL comments on semicolons.

Read back the full calendar, compare all canonical values and retained metadata, and verify upcoming study dates against the website. Preserve subscriber, bulletin, article and delivery history; they are not part of this repair. Remove only the invocation's owned temporary S3 objects after verifying success.

Rollback uses the generated reverse SQL through the same guarded path and requires the matching preserved snapshot. It restores only the original date column and refuses unrelated drift. A code rollback alone would reintroduce the export defect, so retain the converter fix even when investigating a data rollback.
