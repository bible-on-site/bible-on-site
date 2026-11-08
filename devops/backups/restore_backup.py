"""Download exact backup versions and verify restoration in a fresh loopback MySQL."""

import argparse
import json
import os
import re
import tempfile
from pathlib import Path

from mysql_backup import (
    ACCOUNT,
    BUCKET,
    DATABASE,
    INSTANCE,
    REGION,
    BackupError,
    Database,
    restore_archive,
)


def read_manifest(s3, key, version):
    if (
        not re.fullmatch(
            r"(weekly|monthly)/\d{4}/\d{2}/\d{2}/[a-f0-9]{32}/manifest\.json", key
        )
        or not version
        or version == "null"
    ):
        raise BackupError("An exact manifest key and version are required")
    response = s3.get_object(
        Bucket=BUCKET, Key=key, VersionId=version, ExpectedBucketOwner=ACCOUNT
    )
    with response["Body"] as body:
        data = body.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise BackupError("Manifest is too large")
    try:
        manifest = json.loads(data)
        expected = dict(
            format=1,
            account=ACCOUNT,
            region=REGION,
            instance=INSTANCE,
            database=DATABASE,
            bucket=BUCKET,
        )
        if any(manifest.get(k) != v for k, v in expected.items()):
            raise ValueError("Wrong source")
        if manifest["key"] != key.replace("manifest.json", "application.sql.gz"):
            raise ValueError("Wrong archive")
        if not manifest["versionId"] or manifest["versionId"] == "null":
            raise ValueError("Missing version")
        if not re.fullmatch(r"[a-f0-9]{64}", manifest["sha256"]):
            raise ValueError("Missing hash")
        if not isinstance(manifest["bytes"], int) or manifest["bytes"] <= 0:
            raise ValueError("Missing size")
        if not manifest["sourceServerUuid"] or not manifest["restoration"]["tables"]:
            raise ValueError("Missing restoration evidence")
    except (ValueError, KeyError, TypeError, AttributeError):
        raise BackupError("Invalid backup manifest") from None
    return manifest


def restore(s3, key, version, scratch, directory):
    manifest = read_manifest(s3, key, version)
    Path(directory).mkdir(mode=0o700, parents=True, exist_ok=True)
    response = s3.get_object(
        Bucket=BUCKET,
        Key=manifest["key"],
        VersionId=manifest["versionId"],
        ExpectedBucketOwner=ACCOUNT,
    )
    path = Path(directory) / "application.sql.gz"
    with response["Body"] as body, path.open("xb") as output:
        while block := body.read(1024 * 1024):
            output.write(block)
            if output.tell() > manifest["bytes"]:
                raise BackupError("Archive exceeds its recorded size")
    if path.stat().st_size != manifest["bytes"]:
        raise BackupError("Archive size mismatch")
    result = restore_archive(
        scratch, path, directory, manifest["sourceServerUuid"], manifest["sha256"]
    )
    if result != manifest["restoration"]:
        raise BackupError("Restored schema, row counts or table checksums differ")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest_key")
    parser.add_argument("manifest_version")
    args = parser.parse_args()
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        if os.environ.get("AWS_REGION") != REGION:
            raise BackupError("Unexpected configured AWS region")
        session = boto3.Session(region_name=REGION)
        if session.client("sts").get_caller_identity()["Account"] != ACCOUNT:
            raise BackupError("Unexpected AWS account")
        scratch = Database.from_url(os.environ.get("BACKUP_SCRATCH_URL", ""))
        with tempfile.TemporaryDirectory(prefix="bos-restore-") as directory:
            result = restore(
                session.client("s3"),
                args.manifest_key,
                args.manifest_version,
                scratch,
                directory,
            )
            print(
                f"Restore verified: {len(result['tables'])} tables; schema, row counts and checksums match"
            )
    except (BackupError, OSError, BotoCoreError, ClientError) as error:
        print(
            f"Restore failed: {error if isinstance(error, BackupError) else type(error).__name__}"
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
