"""Materialize one local or private S3 media object for local inference."""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import importlib
from pathlib import Path, PurePosixPath
import re
from tempfile import TemporaryDirectory
from typing import BinaryIO


CHUNK_BYTES = 1024 * 1024
ARCHIVE_ACCESS_HELP = (
    "The private archive in #3277 permits its admin service role only. "
    "Use an explicitly authorized read identity or download the file through "
    "admin and pass its local path. This tool does not change AWS permissions."
)


class SourceError(RuntimeError):
    """An input cannot be safely materialized for transcription."""


@dataclass(frozen=True)
class SourceFile:
    """A materialized media file and its immutable input provenance."""

    path: Path
    uri: str
    sha256: str
    filename: str
    metadata: dict[str, object]


def _s3_location(source: str) -> tuple[str, str]:
    """Parse an exact S3 object URI without query or fragment semantics.

    Every character after the bucket's slash belongs to the literal key,
    including question marks, hash signs and percent sequences.
    """
    bucket, separator, key = source.removeprefix("s3://").partition("/")
    if (
        not source.startswith("s3://")
        or not re.fullmatch(r"[a-z0-9][a-z0-9.-]*", bucket)
        or not separator
        or not key
        or key.endswith("/")
        or any(character in source for character in "\r\n\t\x00")
    ):
        raise SourceError(
            "Use s3://bucket/exact-object-key without credentials, port, "
            "or a directory prefix. Characters after the bucket slash are literal."
        )
    return bucket, key


def _copy_media(source: BinaryIO, path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("wb") as media:
        while chunk := source.read(CHUNK_BYTES):
            media.write(chunk)
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def _media_suffix(filename: str) -> str:
    suffix = re.search(r"\.[A-Za-z0-9]{1,10}$", filename)
    return suffix.group() if suffix else ""


@contextmanager
def _local_source(source: str) -> Iterator[SourceFile]:
    path = Path(source).expanduser().resolve()
    if not path.is_file():
        raise SourceError("The local source must be an existing media file.")
    with TemporaryDirectory(prefix="tanahpedia-transcription-") as temporary:
        snapshot = Path(temporary) / f"source-media{_media_suffix(path.name)}"
        with path.open("rb") as original:
            digest, size = _copy_media(original, snapshot)
        if not size:
            raise SourceError("The source media file is empty.")
        yield SourceFile(snapshot, path.as_uri(), digest, path.name, {"contentLength": size})


@contextmanager
def _s3_source(source: str, aws_profile: str | None) -> Iterator[SourceFile]:
    bucket, key = _s3_location(source)
    try:
        boto3 = importlib.import_module("boto3")
        exceptions = importlib.import_module("botocore.exceptions")
    except ImportError as error:
        raise SourceError("S3 input requires boto3; install the transcription dependencies.") from error

    try:
        session = boto3.Session(profile_name=aws_profile)
        client = session.client("s3")
        response = client.get_object(Bucket=bucket, Key=key)
    except (exceptions.BotoCoreError, exceptions.ClientError) as error:
        raise SourceError(f"Unable to read the S3 source. {ARCHIVE_ACCESS_HELP}") from error

    body = response["Body"]
    try:
        with TemporaryDirectory(prefix="tanahpedia-transcription-") as temporary:
            filename = PurePosixPath(key).name
            path = Path(temporary) / f"source-media{_media_suffix(filename)}"
            try:
                digest, size = _copy_media(body, path)
            except (exceptions.BotoCoreError, exceptions.ClientError, OSError) as error:
                raise SourceError("Unable to finish downloading the S3 source.") from error
            if not size:
                raise SourceError("The S3 source media file is empty.")
            expected = response.get("ContentLength")
            if expected is not None and size != expected:
                raise SourceError("The downloaded S3 source length does not match ContentLength.")
            metadata: dict[str, object] = {"contentLength": size}
            for source_key, metadata_key in (("ETag", "etag"), ("VersionId", "versionId")):
                if source_key in response:
                    metadata[metadata_key] = response[source_key]
            yield SourceFile(path, source, digest, filename, metadata)
    finally:
        body.close()


@contextmanager
def materialize_source(source: str, *, aws_profile: str | None = None) -> Iterator[SourceFile]:
    """Yield a private snapshot of one local file or exact S3 object.

    The caller may use the path only inside the context. Both source kinds
    are copied, so editing a local original cannot change the inference input.
    S3 uses the standard
    boto3 credential chain, optionally selecting an existing named profile.
    Archive keys are literal: percent escapes are not URL-decoded, and question
    marks and hash signs are part of the key rather than URL query/fragment delimiters.
    """
    if source.startswith("s3://"):
        with _s3_source(source, aws_profile) as media:
            yield media
    elif "://" in source:
        raise SourceError("Unsupported source URL; use a local path or s3://bucket/exact-object-key.")
    else:
        with _local_source(source) as media:
            yield media
