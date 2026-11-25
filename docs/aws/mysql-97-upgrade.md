# Tanahpedia RDS MySQL 9.7 upgrade

The production upgrade targets `tanah-mysql` in account `250598594267`, region
`il-central-1`. Use RDS Blue/Green Deployments to move from MySQL 8.4 to
9.7.4. The production RDS hostname follows the new writer at switchover.
The additional instance and storage are billed while the two instances exist.
[AWS release announcement](https://aws.amazon.com/about-aws/whats-new/2026/11/amazon-rds-mysql-974-available/)
and [RDS switchover procedure](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-switching.html).

## Before changing production

1. Verify the account, region, source instance identifier and resource ID,
   engine version, approved connection paths, CA expiry, automated backup
   retention and latest restorable time. Check pending engine and OS maintenance,
   and use `describe-db-engine-versions` and
   `describe-orderable-db-instance-options` to verify the exact upgrade target
   and current instance class and storage. Handle any required source OS update
   in its own approved maintenance window and recheck the instance afterward.
2. Verify the newest logical backup and an isolated restore. Take an on-demand
   RDS snapshot before the schema change. Record its ID and the original
   `DbiResourceId` for point-in-time recovery. Use a private disposable restore
   for rehearsal and retain the production network access policy.
3. On the restore, check for native-password accounts, expired TLS certificates,
   legacy hashing in database objects, and unquoted `EXTERNAL` and `LIBRARY`
   identifiers. Run the schema migration below and rehearse the actual target
   engine upgrade. Measure the duration of the article table copy and the
   required write pause. Review RDS compatibility logs before proceeding.
   [RDS MySQL 9.7 prerequisites](https://docs.aws.amazon.com/he_il/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.MySQL.Major.html).
4. Rehearse cold connections over TLS with the deployed website, API,
   admin, bulletin, and data-deploy Lambda. Check the build's dump and import,
   the backup and verified restore, an article search and article-edit conflict
   check, a Hebrew article URL, and a read and write against the isolated
   rehearsal database. Use sandbox destinations for outbound jobs.
5. Package the data-deploy Lambda with its pinned PyMySQL and the regional RDS
   CA bundle using the [packaging instructions](cloudformation/data-deploy/data-deploy-lambda.py).
   Keep the current production artifact and its revision for rollback. Verify
   the SSM fallback and the payload-based caller against the packaged handler.
   Deploy and validate TLS on 8.4 during the approved rollout before switching
   the engine. Confirm production clients reconnect after a connection closes.
6. Deploy the updated API and admin on the existing 8.4 schema. Verify that
   their article relationships and proposal review paths return the same
   editorial token for unchanged articles, then drain all previous API and
   admin tasks. Complete this step before changing the generated column.
7. Check the live application and backup accounts. On 8.4, switch any
   application-managed `mysql_native_password` account to
   `caching_sha2_password` with its existing password and grants. Verify cold
   connections from the deployed clients over TLS. Retain the verified
   operator session until the clients reconnect so it can restore the previous
   plugin on 8.4 if a client fails.

## Migrate the article search fingerprint on 8.4

RDS MySQL 9.7 removes the SQL `MD5()` function, including its use in generated
columns. Run the explicit
[article fingerprint migration](../../devops/deploy/data-deploy/manual/mysql-97-article-fingerprint.sql)
on `tanah` while it is still on MySQL 8.4. Execute it as a single MySQL CLI
session with certificate and hostname verification and stop on the first SQL
error. A normal data deployment uses the compatible expression for new schemas.

Verify the current generation expression and available storage before the
migration. Pause competing article writers. Acquire `article_search_retrain`
on the migration session and verify the session owns it before taking the
baseline counts and recording the expected stale documents. The lock pauses
reconciliation, queue drains, and retrains while the API serves its published
snapshot. The table rebuild allows reads and blocks article writes. It retains
the 16-byte column and sets the current search documents to the new fingerprint.
Documents already behind the article remain eligible for the ordinary reconcile
sweep.

Verify the generated expression uses truncated SHA-256 and the article count,
IDs, current search documents and stale-document set agree with the baseline.
Release the named lock and confirm that search returns the same public URLs. Admin
and API code compute the legacy article-review token from the article fields.
Existing approvals, evidence, deduplication keys and old 32-hex tokens retain
their meaning. The updated schema supports both engine versions, so it can stay
in place if the engine upgrade is delayed or abandoned.

## Create green and switch traffic

1. Verify the live source still meets
   [Blue/Green prerequisites](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-considerations.html).
   After approval, create green using the verified 9.7.4 target and the MySQL 9.7
   parameter family. Keep secure transport enabled. Keep the event scheduler
   disabled on green while it replicates. Record both resource IDs, endpoints
   and original DNS TTL.
2. Wait for green to be available and caught up. Review RDS events and precheck
   logs, TLS and parameter settings, storage initialization, replication lag and
   headroom. Repeat representative read and TLS smoke checks on green using
   approved access. Test writes against the separate rehearsal instance.
3. During the approved cutover window, pause scheduled and interactive writes,
   including data deploys, admin edits and bulletin processing. Hold SSG builds
   and backups so their engine discovery and connection target agree. Drain
   active transactions and verify lag is near zero. Request the RDS switchover
   with a timeout agreed from the rehearsal. Open connections will drop
   briefly and in-flight writes may need application-level retries.
4. Verify the production hostname now serves the 9.7.4 writer and restore the
   normal write paths after read checks pass. Recheck the API, admin, bulletin,
   data deploy, search, representative public and crawled URLs, and the
   scheduled backup and restore. Check for failed reconnects and replication or
   database errors.

## Recovery

Before switchover, production continues on blue. A failed or timed-out RDS
switchover leaves traffic on blue. Keep the old DB after a successful switchover
for at least the required recovery window and verify its backups by the
original resource ID. RDS stops replication after switchover and keeps blue
read-only.

If a successful switchover must be reversed, freeze writers and verify whether
green accepted any writes. Capture and reconcile those writes onto blue before
resuming application traffic. Use the recorded resource IDs to confirm both
targets. Restore write access to blue using the documented RDS `read_only`
procedure and reboot as required.

Rehearse moving green to a different identifier and assigning `tanah-mysql` back
to blue. The backup and SSG workflows resolve this identifier, so confirm the
RDS identifier, live hostname, application SSM settings and
`/bible-on-site-backup/db-url` all point to the same writer.
Allow time for RDS to publish the renamed endpoint. Drain old pools, then verify
reads, writes, SSG and backup preflight before resuming jobs.
[RDS instance renaming](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_RenameInstance.html).

Keep the updated API and admin images while the SHA-256 schema is in use.
Any application rollback image needs the compatible editorial-token calculation.
The cross-version schema and clients can also run on a restored 8.4 snapshot or
PITR instance after verifying the token contract. Rehearse these steps before
approving cutover. Delete temporary instances only after verifying recovery
coverage.
