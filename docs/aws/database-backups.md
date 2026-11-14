# Independent database backups (#1828)

Status: implemented for review; production activation requires approval of this
PR and the setup below. Existing RDS seven-day automated backups remain in use.
This mechanism protects application data beyond that window and independently
of the RDS instance's lifecycle. It is not a copy outside AWS account 250598594267.
Account-wide compromise or account closure requires a separately controlled
off-account copy; S3 governance retention can be bypassed by an authorized
administrator. No cross-account protection is claimed.

## Data and retention

- Account `250598594267`, region `il-central-1`, RDS `tanah-mysql`, database
  `tanah`. Every application table is exported, including `parshan`, `perush`
  and `note`. MySQL system accounts and RDS instance configuration are not SQL
  application content; preserve their separate infrastructure configuration.
- Sunday at 02:23 UTC: a full weekly export, retained for 56 days. First day of
  each month at 02:43 UTC: a full monthly export, retained for 366 days.
- Private bucket `bible-on-site-db-backups-250598594267-il-central-1`, SSE-S3
  encryption, versioning, TLS-only policy and S3 Object Lock in governance mode.
  Monthly objects explicitly request 366-day protection; the bucket's fallback
  is 56 days. Lifecycle expires old copies and unfinished uploads. Locked
  versions survive expiration until their retention ends; noncurrent versions
  become eligible for deletion one day later. Boundary days can briefly retain
  an extra weekly/monthly copy.
- The dedicated writer can create retained objects and abort its uploads. It
  cannot download or delete backups, bypass retention, administer the bucket or
  read the application's existing administrator credential.
- The dump account has `SELECT`, `SHOW VIEW`, `TRIGGER`, `EVENT` on `tanah.*`
  and global `SHOW_ROUTINE`. It has no data INSERT/UPDATE/DELETE grants.
  `TRIGGER` and `EVENT` also permit managing those object definitions; this is a
  dedicated dump account, not a claim that MySQL offers a purely read-only
  permission covering every stored object. TLS is required.

The existing owned-rule helper grants this job's runner IPv4 `/32` access to
port 3306 and removes only its tagged rule in an `always()` cleanup step. The
role's network permissions are scoped to the RDS security group. EC2 does not
evaluate new-rule request tags when authorizing ingress against an existing
group — `TagSpecifications` describe the created rule, not the group resource —
so the deployed `LeaseOnlyTheDatabaseGroup` statement scopes that authorization
to the stack's region (`ec2:Region=il-central-1`) and the database VPC
(`ec2:Vpc`). New-rule tag restrictions remain on the `security-group-rule` and
`CreateTags` authorizations. EC2 authorizes revocation on that group and cannot
enforce rule-tag ownership in IAM: the trusted cleanup helper validates account,
group, exact rule ID, TCP port 3306, runner `/32` and all lease tags before
removing its rule. The role could revoke other rules in that one group if its
credentials or trusted workflow were compromised; it has no revocation grant
for other groups. Initial preflight checks the account, RDS engine, source
credential, attached security group and S3 protection before that grant. A
changed security group fails closed
and requires the workflow/role parameters to be updated together.

Normal data deployments and backups share the repository's `-cd-data`
concurrency group. InnoDB's consistent snapshot permits normal content edits.
Manual schema changes must also be scheduled outside the backup; schema metadata
is checked before and after export to reject drift. Non-InnoDB tables fail the
backup rather than produce a misleading consistent-snapshot claim.

## What success proves

The worker streams `mysqldump` through gzip without writing an uncompressed
production dump. It uses the regional RDS CA bundle and verifies the hostname.
Routines, triggers, events, views, binary values and all tables are included;
GTID state and tablespace administration are excluded.

Before upload, it imports the compressed archive into a fresh, disposable
MySQL 8.4 server on `127.0.0.1`, with the event scheduler and local infile
disabled. The setup action launches that server bound to all interfaces
(`--bind-address=*` overrides the loopback `my-cnf` setting), so the workflow
constrains port 3306 to the runner's loopback at the host firewall before the
server starts and then proves non-loopback connections are refused. The
loopback-only client requests the server's RSA public key for its first
`caching_sha2_password` login, which would otherwise fail cold without a secure
channel; the verified-TLS source path keeps `VERIFY_IDENTITY`. Scratch identity,
version, event scheduler and emptiness are validated before the complete
production export runs, so a cold-cache credential or isolation failure aborts
the run early. It rejects an existing database or the source server's UUID.
Schema metadata must match, including constraints and stored-object
definitions. The
manifest records per-table row counts and extended table checksums from that
restoration, plus archive SHA-256, byte size and exact S3 object version.
Failures report only the failed phase and the numeric MySQL error code; SQL,
client stderr, credentials and content stay out of logs and artifacts.

S3 validates each multipart SHA-256 checksum. The immutable version-pinned
manifest is written last; an export, restore, checksum, upload or manifest error
fails the job. A data object without its committed manifest is an incomplete
backup, not a recovery point. No production contents, SQL stderr or credentials
are logged or uploaded to GitHub artifacts. Private temporary files are removed
when the worker exits; the GitHub runner and its disposable database are discarded.

## Approved production setup

Perform this section only after Dorad approves the specific PR and these live
changes. Use existing SSO profile `AdministratorAccess-250598594267` and verify
`aws sts get-caller-identity` reports the target account before each application.

1. Confirm RDS is available, MySQL 8.4 and its current security group is
   `sg-09268677e2b65f448`. Verify the existing GitHub OIDC provider and resolve
   `alias/aws/ssm` to its key ARN with `aws kms describe-key`. Validate the
   CloudFormation template, then deploy **a new stack** named
   `bible-on-site-db-backups` from [db-backups.yaml](cloudformation/db-backups.yaml),
   with `RdsSecurityGroupId` and `SsmKeyArn` set to those verified values and
   `CAPABILITY_NAMED_IAM`. This stack creates the private retained bucket, its
   policy and the new OIDC writer role; it does not manage the existing DB,
   security group, application roles or asset buckets. The deployed stack
   `bible-on-site-db-backups` is UPDATE_COMPLETE with the corrected
   `LeaseOnlyTheDatabaseGroup` condition (region/VPC, not `aws:RequestTag` on
   the group); do not redeploy an older template revision that conditioned the
   security-group authorization on request tags.
2. Through a short-lived, task-owned `/32` MySQL access rule, connect to the
   verified RDS endpoint with the regional CA and `VERIFY_IDENTITY`. Inspect
   non-system schemas and confirm the application's entire content is in
   `tanah`; investigate any additional application schema before enabling.
   Generate a unique random password locally. Refuse to overwrite an existing
   `bos_backup` user or `/bible-on-site-backup/db-url` parameter. Apply:

   ```sql
   CREATE USER 'bos_backup'@'%' IDENTIFIED BY '<generated password>' REQUIRE SSL;
   GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON tanah.* TO 'bos_backup'@'%';
   GRANT SHOW_ROUTINE ON *.* TO 'bos_backup'@'%';
   ```

   Store its URL as SecureString `/bible-on-site-backup/db-url` using
   `alias/aws/ssm`, through the SDK or a private file (never a shell argument,
   workflow output or repository file). Use URL-encoded credentials and the
   verified endpoint, port 3306 and `/tanah`. Remove the owned bootstrap rule
   in a `finally` cleanup. If credential storage fails, remove only the newly
   created backup user; application credentials are preserved.
3. Verify that the writer's policies restrict SSM to that one parameter, S3 to
   the new bucket/prefixes and network changes to the verified database group
   within its region and VPC.
   Recheck the helper's complete lease ownership validation before cleanup;
   per-rule revocation ownership is enforced by that code, not IAM.
   Set repository variable `PRODUCTION_BACKUPS_ENABLED=true` only after the
   merged workflow's checks pass. Before this variable exists, every scheduled
   and manual backup job is skipped.
4. Dispatch `db-backup.yml` on `master` with tier `weekly`; observe the first
   run and production health. Verify its owned ingress rule is gone afterward.
   Verify a private, encrypted, retained archive version and matching manifest
   exist. Repeat for `monthly` and inspect its 366-day lock.
5. As the separate SSO recovery operator, download an exact manifest/archive
   version and execute the independent restore procedure below. Record the
   run, object versions, retention dates, compressed size and restore verdict
   in #1828. Close the issue only after that production-derived test succeeds.

S3 storage and requests are billable. Actual compressed size is measured by the
first approved export; retention capacity is approximately 8 weekly plus 12
monthly archives and small manifests. There is no always-on new AWS compute,
NAT gateway, replica or scratch RDS instance. Recovery download/compute costs
depend on where an operator restores. Do not describe the solution as free or
quote a fixed monthly price without measuring the archive and regional pricing.
The [regional AWS price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/il-central-1/index.json)
checked during preparation lists S3 Standard at $0.025/GB-month for the first
50 TB. As an illustration, twenty 100 MiB archives use about 1.95 GiB and cost
about $0.05/month for storage, plus requests; twenty 20 GB archives cost about
$10/month for storage. These are size scenarios, not measured production costs.

GitHub schedules are best effort: they can be delayed/dropped and are disabled
after 60 inactive days in public repositories. Keep Actions failure notifications
enabled, check run history and the newest committed manifest regularly, and
dispatch a replacement when a scheduled copy is missing. RDS PITR remains the
short-window recovery path. This workflow does not claim an externally monitored
backup freshness SLA.

## Independent restoration drill

Use an isolated host with MySQL 8.4 CLI tools, Python 3.14, the pinned
[backup requirements](../../devops/backups/requirements.txt), and the recovery
operator's SSO session. The backup writer deliberately has no object-read grant.
Obtain the manifest's **version ID** with `aws s3api list-object-versions`,
using the expected bucket owner. Do not use an unversioned latest object.

Start an empty, disposable MySQL 8.4 server bound only to loopback; set
`event_scheduler=OFF` and `local_infile=OFF`. The `tanah` database must not exist.
Set `BACKUP_SCRATCH_URL` through the environment with its local root credential,
and set `AWS_PROFILE=AdministratorAccess-250598594267`, `AWS_REGION=il-central-1`.

```text
python devops/backups/restore_backup.py <exact-manifest-key> <manifest-version-id>
```

This command reads only the approved bucket/account, downloads the archive's
exact recorded version, verifies compressed size and SHA-256 before import,
then checks schema, row counts and table checksums against the committed
manifest. It refuses remote targets, existing databases and the source UUID.
Record the non-sensitive verification result and destroy only the disposable
scratch database/container. The command never replaces a live database.

For an actual incident, restore to an approved **replacement** instance using
matching infrastructure and grants, validate data and application behavior,
then approve a separate application connection cutover. Preserve the previous
instance/connection for rollback. RDS PITR, SQL data recovery and application
cutover are distinct operations; a scratch import is not a tested production
cutover.

## Rollback

Set `PRODUCTION_BACKUPS_ENABLED=false` and let any active run finish/clean up.
Revoke the new backup user's grants and remove its dedicated parameter and IAM
role after checking no job is active. Remove only an owned leftover access rule,
never another task's rule. Retain the backup bucket and committed versions:
CloudFormation deletion and replacement both retain it. Object Lock remains
enabled; its protected versions are deliberately preserved through rollback.
An administrator's explicit governance bypass/deletion is a separate operation.
The application's database, credentials, RDS retention and public/crawled URLs
are preserved.

## Validation

```text
python -m pip install -r devops/backups/requirements-test.txt
cfn-lint docs/aws/cloudformation/db-backups.yaml
coverage run --rcfile=devops/backups/.coveragerc -m unittest discover -s devops/backups -p "test_*.py"
coverage run --append --rcfile=devops/backups/.coveragerc devops/backups/integration_test.py
coverage report --rcfile=devops/backups/.coveragerc
```

The integration test creates its own internal Docker network and disposable
source/scratch/client containers, with a test-only TLS certificate. It exercises
the actual MySQL 8.4 client, full export/import and a second version-pinned
recovery. Its S3 transport is an in-memory test double; a successful test is not
a claim of a production S3 upload, IAM authorization or production-data restore.

References: [mysqldump privileges and snapshot limits](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html),
[S3 Object Lock and lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html),
[EC2 action and resource authorization](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ec2.html),
[GitHub scheduled-event limits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
