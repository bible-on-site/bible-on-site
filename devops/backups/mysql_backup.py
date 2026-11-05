"""Produce a restorable, versioned application backup without logging data or credentials."""

import argparse
import base64
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess  # nosec B404 # MySQL CLI uses argv, no shell, and private option files.
import tempfile
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import urlopen

# Public target identifier, deliberately checked before any production operation.
# nosemgrep: generic.secrets.security.detected-aws-account-id.detected-aws-account-id
ACCOUNT = "250598594267"
REGION = "il-central-1"
INSTANCE = "tanah-mysql"
DATABASE = "tanah"
BUCKET = f"bible-on-site-db-backups-{ACCOUNT}-{REGION}"
PARAMETER = "/bible-on-site-backup/db-url"
RETENTION = {"weekly": 56, "monthly": 366}
PART_BYTES = 16 * 1024 * 1024
BLOCK_BYTES = 1024 * 1024


class BackupError(RuntimeError):
    """An operational failure whose message contains no database content or secrets."""


def identifier(value):
    """Accept only the identifier alphabet used by this application's schemas."""
    if not re.fullmatch(r"[A-Za-z0-9_]{1,64}", value):
        raise BackupError("Unsupported database identifier")
    return f"`{value}`"


def digest(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False) + "\n").encode()


def fingerprint(value):
    return hashlib.sha256(json_bytes(value)).hexdigest()


def diagnostics(phase, stderr):
    """Return a phase-labeled error carrying only the numeric client error code."""
    # Raw client stderr may contain credentials, SQL or data fragments; only
    # the standard ``ERROR <code>`` number is propagated into the job log.
    match = re.search(rb"ERROR (\d+)", stderr or b"", re.IGNORECASE)
    if match:
        return BackupError(
            f"{phase} failed (MySQL error {match.group(1).decode('ascii')})"
        )
    return BackupError(f"{phase} failed")


def error_path(directory, name):
    """Reserve a private stderr capture path inside the working directory."""
    return Path(directory) / f"{name}-{uuid.uuid4().hex}.stderr"


@dataclass(repr=False)
class Database:
    host: str
    port: int
    username: str
    password: str
    name: str
    ca: str | None = None

    @classmethod
    def from_url(cls, value, ca=None):
        try:
            url = urlparse(value)
            if url.scheme != "mysql" or url.query or url.fragment:
                raise ValueError("Unsupported URL shape")
            result = cls(
                url.hostname or "",
                url.port or 3306,
                unquote(url.username or ""),
                unquote(url.password or ""),
                unquote(url.path.lstrip("/")),
                ca,
            )
            identifier(result.name)
            if not result.host or not result.username or not result.password:
                raise ValueError("Missing credentials")
            return result
        except ValueError:
            raise BackupError("Invalid database connection configuration") from None

    def defaults(self, directory):
        def quote(value):
            return (
                '"'
                + str(value)
                .replace("\\", "\\\\")
                .replace('"', '\\"')
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                + '"'
            )

        path = Path(directory) / f"client-{uuid.uuid4().hex}.cnf"
        # Exclusive creation with private permissions also keeps credentials out
        # of process arguments, environment inheritance and the workflow log.
        with open(
            path,
            "x",
            encoding="utf-8",
            opener=lambda p, flags: os.open(p, flags, 0o600),
        ) as file:
            file.write("[client]\n")
            for key, value in {
                "host": self.host,
                "port": self.port,
                "user": self.username,
                "password": self.password,
            }.items():
                # MySQL requires plaintext options: exclusive mode 0600, task temp
                # directory, never an artifact; every caller unlinks in finally.
                # codeql[py/clear-text-storage-sensitive-data]
                file.write(f"{key}={quote(value)}\n")
        return path

    def executable(self, tool):
        """Resolve only the installed MySQL tools to an absolute executable path."""
        if tool not in ("mysql", "mysqldump"):
            raise BackupError("Unsupported database executable")
        resolved = shutil.which(tool)
        if not resolved:
            raise BackupError("Required MySQL executable is unavailable")
        return str(Path(resolved).resolve())

    def command(self, tool, defaults):
        args = [self.executable(tool), f"--defaults-file={defaults}", "--protocol=TCP"]
        if self.ca:
            args += ["--ssl-mode=VERIFY_IDENTITY", f"--ssl-ca={self.ca}"]
        else:
            # Only the disposable loopback restore server may omit TLS. Its
            # first caching_sha2_password login has no warm cache and no TLS
            # channel, so the RSA public-key exchange is required (otherwise
            # the client fails cold with MySQL error 2061). This option stays
            # confined to this loopback-only branch.
            if self.host != "127.0.0.1":
                raise BackupError("TLS verification is required for remote databases")
            args += ["--ssl-mode=DISABLED", "--get-server-public-key"]
        return args

    def query(self, sql, directory, phase):
        config = self.defaults(directory)
        try:
            # Absolute allowlisted CLI; SQL is stdin and credentials are private options.
            # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit.dangerous-subprocess-use-audit
            result = subprocess.run(  # nosec B603 # Validated argv; shell is disabled.
                self.command("mysql", config)
                + ["--batch", "--raw", "--skip-column-names"],
                input=sql.encode(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                shell=False,
            )
            if result.returncode:
                raise diagnostics(phase, result.stderr)
            return result.stdout.decode("utf-8").splitlines()
        finally:
            config.unlink()


def server_identity(database, directory, phase):
    rows = database.query(
        "SELECT JSON_OBJECT('uuid',@@server_uuid,'version',@@version,'events',@@event_scheduler);",
        directory,
        phase,
    )
    if len(rows) != 1:
        raise BackupError("Missing server identity")
    return json.loads(rows[0])


def catalog(database, directory, phase):
    """Capture stable schema metadata, excluding changing row counts and auto-increments."""
    name = database.name
    identifier(name)
    definitions = [
        (
            "SCHEMATA",
            "SCHEMA_NAME",
            "'charset',DEFAULT_CHARACTER_SET_NAME,'collation',DEFAULT_COLLATION_NAME",
        ),
        (
            "TABLES",
            "TABLE_NAME",
            "'name',TABLE_NAME,'type',TABLE_TYPE,'engine',COALESCE(ENGINE,''),'collation',TABLE_COLLATION",
        ),
        (
            "COLUMNS",
            "TABLE_NAME,ORDINAL_POSITION",
            "'table',TABLE_NAME,'ordinal',ORDINAL_POSITION,'name',COLUMN_NAME,"
            + "'type',COLUMN_TYPE,'nullable',IS_NULLABLE,'default',COLUMN_DEFAULT,"
            + "'extra',EXTRA,'collation',COLLATION_NAME,'generation',GENERATION_EXPRESSION",
        ),
        (
            "STATISTICS",
            "TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX",
            "'table',TABLE_NAME,'index',INDEX_NAME,'ordinal',SEQ_IN_INDEX,'column',COLUMN_NAME,'expression',EXPRESSION,'unique',NON_UNIQUE,'type',INDEX_TYPE",
        ),
        (
            "TABLE_CONSTRAINTS",
            "TABLE_NAME,CONSTRAINT_NAME",
            "'table',TABLE_NAME,'name',CONSTRAINT_NAME,'type',CONSTRAINT_TYPE,'enforced',ENFORCED",
        ),
        (
            "KEY_COLUMN_USAGE",
            "TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION",
            "'table',TABLE_NAME,'constraint',CONSTRAINT_NAME,'ordinal',ORDINAL_POSITION,"
            + "'column',COLUMN_NAME,'referenceTable',REFERENCED_TABLE_NAME,"
            + "'referenceColumn',REFERENCED_COLUMN_NAME",
        ),
        (
            "REFERENTIAL_CONSTRAINTS",
            "TABLE_NAME,CONSTRAINT_NAME",
            "'table',TABLE_NAME,'constraint',CONSTRAINT_NAME,'update',UPDATE_RULE,'delete',DELETE_RULE",
        ),
        (
            "CHECK_CONSTRAINTS",
            "CONSTRAINT_NAME",
            "'constraint',CONSTRAINT_NAME,'clause',CHECK_CLAUSE",
        ),
        (
            "VIEWS",
            "TABLE_NAME",
            "'name',TABLE_NAME,'definition',VIEW_DEFINITION,'check',CHECK_OPTION,'security',SECURITY_TYPE,'definer',DEFINER",
        ),
        (
            "TRIGGERS",
            "TRIGGER_NAME",
            "'name',TRIGGER_NAME,'table',EVENT_OBJECT_TABLE,'event',EVENT_MANIPULATION,"
            + "'timing',ACTION_TIMING,'order',ACTION_ORDER,'definition',ACTION_STATEMENT,"
            + "'definer',DEFINER,'mode',SQL_MODE",
        ),
        (
            "ROUTINES",
            "ROUTINE_NAME,ROUTINE_TYPE",
            "'name',ROUTINE_NAME,'type',ROUTINE_TYPE,'definition',ROUTINE_DEFINITION,'definer',DEFINER,'security',SECURITY_TYPE,'mode',SQL_MODE",
        ),
        (
            "PARAMETERS",
            "SPECIFIC_NAME,ORDINAL_POSITION",
            "'routine',SPECIFIC_NAME,'ordinal',ORDINAL_POSITION,'name',PARAMETER_NAME,"
            + "'mode',PARAMETER_MODE,'type',DTD_IDENTIFIER,'charset',CHARACTER_SET_NAME,"
            + "'collation',COLLATION_NAME",
        ),
        (
            "EVENTS",
            "EVENT_NAME",
            "'name',EVENT_NAME,'definition',EVENT_DEFINITION,'definer',DEFINER,"
            + "'status',STATUS,'mode',SQL_MODE,'type',EVENT_TYPE,'at',EXECUTE_AT,"
            + "'interval',INTERVAL_VALUE,'unit',INTERVAL_FIELD,'start',STARTS,"
            + "'end',ENDS,'completion',ON_COMPLETION,'zone',TIME_ZONE",
        ),
    ]
    result = {}
    for table, order, fields in definitions:
        schema = {
            "SCHEMATA": "SCHEMA_NAME",
            "TRIGGERS": "TRIGGER_SCHEMA",
            "ROUTINES": "ROUTINE_SCHEMA",
            "PARAMETERS": "SPECIFIC_SCHEMA",
            "EVENTS": "EVENT_SCHEMA",
            "CHECK_CONSTRAINTS": "CONSTRAINT_SCHEMA",
            "REFERENTIAL_CONSTRAINTS": "CONSTRAINT_SCHEMA",
        }.get(table, "TABLE_SCHEMA")
        result[table] = [
            json.loads(row)
            for row in database.query(
                # Fragments are fixed above; name passed identifier() before this loop.
                f"SELECT JSON_OBJECT({fields}) FROM information_schema.{table} WHERE {schema}='{name}' ORDER BY {order};",  # nosec B608
                directory,
                phase,
            )
        ]
    tables = [row for row in result["TABLES"] if row["type"] == "BASE TABLE"]
    if not tables or any(row["engine"] != "InnoDB" for row in tables):
        raise BackupError(
            "A consistent backup requires nonempty InnoDB application tables"
        )
    return result


def dump_archive(database, path, directory):
    identifier(database.name)
    config = database.defaults(directory)
    errors = error_path(directory, "mysqldump")
    try:
        args = database.command("mysqldump", config) + [
            "--single-transaction",
            "--quick",
            "--no-tablespaces",
            "--column-statistics=0",
            "--set-gtid-purged=OFF",
            "--default-character-set=utf8mb4",
            "--hex-blob",
            "--routines",
            "--events",
            "--triggers",
            "--databases",
            database.name,
        ]
        with open(
            errors, "xb", opener=lambda p, flags: os.open(p, flags, 0o600)
        ) as log:
            # Absolute allowlisted CLI, fixed flags, validated schema and private options.
            # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit.dangerous-subprocess-use-audit
            with subprocess.Popen(  # nosec B603 # Argv only; no shell interpretation.
                args, stdout=subprocess.PIPE, stderr=log, shell=False
            ) as process:
                with gzip.open(path, "wb", compresslevel=6) as output:
                    while block := process.stdout.read(BLOCK_BYTES):
                        output.write(block)
                failed = bool(process.wait())
        if failed:
            raise diagnostics("Source export", errors.read_bytes())
    finally:
        config.unlink()
        errors.unlink(missing_ok=True)


def validate_scratch(database, directory, source_uuid):
    """Prove a fresh loopback scratch target authenticates and is safe and empty."""
    if database.host != "127.0.0.1" or database.name != DATABASE:
        raise BackupError("Restore target must be a fresh loopback tanah database")
    identity = server_identity(database, directory, "Scratch identity query")
    if identity["uuid"] == source_uuid or identity["events"] != "OFF":
        raise BackupError("Unsafe restore server identity or event scheduler")
    if not identity["version"].startswith("8.4."):
        raise BackupError("Restoration requires a MySQL 8.4 scratch server")
    if database.query(
        "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='tanah';",
        directory,
        "Scratch emptiness query",
    ):
        raise BackupError("Refusing to overwrite an existing database")


def restore_archive(database, path, directory, source_uuid, sha256):
    """Import only into a fresh loopback database with its event scheduler disabled."""
    if digest(path) != sha256:
        raise BackupError("Archive SHA-256 mismatch")
    validate_scratch(database, directory, source_uuid)
    config = database.defaults(directory)
    errors = error_path(directory, "mysql-import")
    try:
        with open(
            errors, "xb", opener=lambda p, flags: os.open(p, flags, 0o600)
        ) as log:
            # Absolute allowlisted CLI; the archived SQL flows through stdin only.
            # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit.dangerous-subprocess-use-audit
            with subprocess.Popen(  # nosec B603 # Fixed CLI, private options, no shell.
                # Fixed executable/flags, private defaults file; dump is stdin, never argv.
                # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-tainted-env-args.dangerous-subprocess-use-tainted-env-args
                database.command("mysql", config) + ["--binary-mode"],
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=log,
                shell=False,
            ) as process:
                try:
                    with gzip.open(path, "rb") as source:
                        while block := source.read(BLOCK_BYTES):
                            process.stdin.write(block)
                except BrokenPipeError:
                    raise BackupError("Scratch import rejected the dump") from None
                finally:
                    process.stdin.close()
                failed = bool(process.wait())
        if failed:
            raise diagnostics("Scratch import", errors.read_bytes())
    finally:
        config.unlink()
        errors.unlink(missing_ok=True)
    schema = catalog(database, directory, "Restored catalog query")
    counts = {}
    for row in schema["TABLES"]:
        if row["type"] == "BASE TABLE":
            table = identifier(row["name"])
            count = database.query(
                # Both identifiers strictly allowlisted and quoted by identifier().
                f"SELECT COUNT(*) FROM {identifier(DATABASE)}.{table};",  # nosec B608
                directory,
                "Restored table query",
            )
            checksum = database.query(
                f"CHECKSUM TABLE {identifier(DATABASE)}.{table} EXTENDED;",
                directory,
                "Restored table query",
            )
            value = checksum[0].split("\t")[1]
            if not value.isdecimal():
                raise BackupError("A restored table checksum could not be calculated")
            counts[row["name"]] = {"rows": int(count[0]), "checksum": value}
    return {"schemaSha256": fingerprint(schema), "tables": counts}


def upload_archive(s3, path, key, until):
    """Upload bounded parts with service-validated checksums and record the exact version."""
    common = dict(Bucket=BUCKET, Key=key, ExpectedBucketOwner=ACCOUNT)
    headers = dict(
        ServerSideEncryption="AES256",
        ObjectLockMode="GOVERNANCE",
        ObjectLockRetainUntilDate=until,
        ChecksumAlgorithm="SHA256",
    )
    with Path(path).open("rb") as source:
        upload = s3.create_multipart_upload(
            **common, **headers, ContentType="application/gzip"
        )
        completed = False
        try:
            parts = []
            while block := source.read(PART_BYTES):
                number = len(parts) + 1
                if number > 10000:
                    raise BackupError("Archive exceeds multipart upload capacity")
                checksum = base64.b64encode(hashlib.sha256(block).digest()).decode()
                response = s3.upload_part(
                    **common,
                    UploadId=upload["UploadId"],
                    PartNumber=number,
                    Body=block,
                    ChecksumSHA256=checksum,
                )
                if response.get("ChecksumSHA256") != checksum:
                    raise BackupError("S3 part checksum mismatch")
                parts.append(
                    dict(
                        PartNumber=number,
                        ETag=response["ETag"],
                        ChecksumSHA256=checksum,
                    )
                )
            if not parts:
                raise BackupError("Empty backup archive")
            result = s3.complete_multipart_upload(
                **common, UploadId=upload["UploadId"], MultipartUpload={"Parts": parts}
            )
            completed = True
            if not result.get("VersionId") or result["VersionId"] == "null":
                raise BackupError("S3 did not return a retained object version")
            return result["VersionId"]
        finally:
            if not completed:
                s3.abort_multipart_upload(**common, UploadId=upload["UploadId"])


def backup(source, scratch, s3, kind, directory, *, now=None, run=None):
    if kind not in RETENTION:
        raise BackupError("Unsupported backup retention tier")
    now = now or datetime.now(UTC)
    identity = server_identity(source, directory, "Source identity query")
    before = catalog(source, directory, "Source catalog query")
    # Prove the scratch target authenticates and is a safe empty restore server
    # before the complete production export runs; a cold-cache credential or
    # isolation failure must abort here, not after reading the whole database.
    validate_scratch(scratch, directory, identity["uuid"])
    path = Path(directory) / "application.sql.gz"
    dump_archive(source, path, directory)
    if before != catalog(source, directory, "Source catalog query"):
        raise BackupError("Schema changed during export; discard this backup")
    sha256 = digest(path)
    restored = restore_archive(scratch, path, directory, identity["uuid"], sha256)
    if restored["schemaSha256"] != fingerprint(before):
        raise BackupError("Restored schema does not match the exported schema")
    until = now + timedelta(days=RETENTION[kind])
    key = f"{kind}/{now:%Y/%m/%d}/{uuid.uuid4().hex}/application.sql.gz"
    version = upload_archive(s3, path, key, until)
    manifest = dict(
        format=1,
        account=ACCOUNT,
        region=REGION,
        instance=INSTANCE,
        database=DATABASE,
        sourceServerUuid=identity["uuid"],
        serverVersion=identity["version"],
        kind=kind,
        startedAt=now.isoformat(),
        retainUntil=until.isoformat(),
        bucket=BUCKET,
        key=key,
        versionId=version,
        bytes=path.stat().st_size,
        sha256=sha256,
        restoration=restored,
        run=run,
    )
    data = json_bytes(manifest)
    result = s3.put_object(
        Bucket=BUCKET,
        Key=key.replace("application.sql.gz", "manifest.json"),
        ExpectedBucketOwner=ACCOUNT,
        Body=data,
        ContentType="application/json",
        ServerSideEncryption="AES256",
        ObjectLockMode="GOVERNANCE",
        ObjectLockRetainUntilDate=until,
        ChecksumSHA256=base64.b64encode(hashlib.sha256(data).digest()).decode(),
    )
    if not result.get("VersionId") or result["VersionId"] == "null":
        raise BackupError("Manifest publication did not return a retained version")
    return manifest


def preflight(session, directory):
    if session.client("sts").get_caller_identity()["Account"] != ACCOUNT:
        raise BackupError("Unexpected AWS account")
    instance = session.client("rds").describe_db_instances(
        DBInstanceIdentifier=INSTANCE
    )["DBInstances"][0]
    if instance["DBInstanceStatus"] != "available" or instance["Engine"] != "mysql":
        raise BackupError("RDS instance is not an available MySQL source")
    if not instance.get("EngineVersion", "").startswith("8.4."):
        raise BackupError("Backup and restoration tools require MySQL 8.4")
    groups = [
        group["VpcSecurityGroupId"] for group in instance.get("VpcSecurityGroups", [])
    ]
    if os.environ.get("RDS_SECURITY_GROUP") not in groups:
        raise BackupError(
            "Configured access lease group is not attached to this database"
        )
    ca = Path(directory) / "rds-ca.pem"
    # Fixed AWS HTTPS trust store, with normal certificate validation and no user URL.
    # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
    with urlopen(  # nosec B310 # Only this literal HTTPS URL can be requested.
        "https://truststore.pki.rds.amazonaws.com/il-central-1/il-central-1-bundle.pem",
        timeout=30,
    ) as response:
        ca.write_bytes(response.read())
    value = session.client("ssm").get_parameter(Name=PARAMETER, WithDecryption=True)[
        "Parameter"
    ]["Value"]
    source = Database.from_url(value, str(ca))
    if (source.host, source.port, source.name, source.username) != (
        instance["Endpoint"]["Address"],
        instance["Endpoint"]["Port"],
        DATABASE,
        "bos_backup",
    ):
        raise BackupError(
            "Backup credential does not match the expected dedicated source"
        )
    s3 = session.client("s3")
    owner = dict(Bucket=BUCKET, ExpectedBucketOwner=ACCOUNT)
    if s3.get_bucket_versioning(**owner).get("Status") != "Enabled":
        raise BackupError("Backup bucket versioning is not enabled")
    lock = s3.get_object_lock_configuration(**owner)["ObjectLockConfiguration"]
    retention = lock.get("Rule", {}).get("DefaultRetention", {})
    if (
        lock.get("ObjectLockEnabled") != "Enabled"
        or retention.get("Mode") != "GOVERNANCE"
        or retention.get("Days", 0) < 56
    ):
        raise BackupError("Backup bucket retention is not configured")
    public = s3.get_public_access_block(**owner)["PublicAccessBlockConfiguration"]
    if not all(
        public.get(key)
        for key in [
            "BlockPublicAcls",
            "IgnorePublicAcls",
            "BlockPublicPolicy",
            "RestrictPublicBuckets",
        ]
    ):
        raise BackupError("Backup bucket public access is not blocked")
    return source, s3


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["check", *RETENTION])
    args = parser.parse_args()
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        if os.environ.get("AWS_REGION") != REGION:
            raise BackupError("Unexpected configured AWS region")
        with tempfile.TemporaryDirectory(prefix="bos-backup-") as directory:
            session = boto3.Session(region_name=REGION)
            source, s3 = preflight(session, directory)
            if args.kind == "check":
                print(
                    "Backup target, credential scope and bucket protection checks passed"
                )
                return 0
            scratch = Database.from_url(os.environ.get("BACKUP_SCRATCH_URL", ""))
            result = backup(
                source,
                scratch,
                s3,
                args.kind,
                directory,
                run=os.environ.get("GITHUB_RUN_ID"),
            )
            print(
                f"Verified backup committed: s3://{BUCKET}/{result['key']} version {result['versionId']}"
            )
    except (
        BackupError,
        OSError,
        subprocess.SubprocessError,
        BotoCoreError,
        ClientError,
    ) as error:
        # SQL stderr, URLs and AWS response messages can contain private data.
        print(
            f"Backup failed: {error if isinstance(error, BackupError) else type(error).__name__}"
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
