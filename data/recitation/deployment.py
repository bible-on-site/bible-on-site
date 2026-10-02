"""Verify a built/deployed website exposes approved timings and playable source audio."""
import argparse
from contextlib import contextmanager
from http.client import HTTPConnection, HTTPSConnection, HTTPException
import hashlib
import json
from pathlib import Path
import time
from urllib.parse import urlsplit

from alignment import load_chapters
from publish import DATABASE, extract



@contextmanager
def http_response(url, headers=None, timeout=20):
    # Use protocol-specific clients: file/custom schemes and redirects cannot
    # become local file reads, including URLs returned by a broken deployment.
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
        raise ValueError("Deployment verification only supports public HTTP(S) URLs")
    client = (HTTPSConnection if parts.scheme == "https" else HTTPConnection)(
        parts.hostname, parts.port, timeout=timeout)
    try:
        client.request("GET", (parts.path or "/") + (f"?{parts.query}" if parts.query else ""), headers=headers or {})
        response = client.getresponse()
        if response.status != 200:
            raise ValueError(f"Deployment HTTP request returned {response.status}")
        yield response
    finally:
        client.close()


def verify(origin, version, database=DATABASE, check_audio=False):
    records = [extract(pid, chapter) for pid, chapter in load_chapters(database).items()
               if "recitation" in chapter]
    approved = [r for r in records if r["alignmentStatus"] == "ready"]
    unapproved = next((r for r in records if r["alignmentStatus"] != "ready"), None)
    if not approved:
        raise ValueError("No approved recitation available for deployment verification")
    # Check every approved chapter plus a chapter that must remain chapter-only.
    for expected in approved + ([unapproved] if unapproved else []):
        pid = expected["perekId"]
        url = f"{origin.rstrip('/')}/api/recitation/{pid}?deployment={version}"
        with http_response(url, {"Cache-Control": "no-cache"}) as response:
            if response.headers.get("X-Website-Version") != version:
                raise ValueError(f"{pid}: expected website {version} is not serving yet")
            actual = json.load(response)
        audio_url = actual.pop("audioUrl", None)
        reference = {k: v for k, v in expected.items() if k != "audioUrl"}
        if actual != reference:
            raise ValueError(f"{pid}: deployed metadata or canonical word intervals differ")
        if not isinstance(audio_url, str) or urlsplit(audio_url).path.rsplit('/', 1)[-1] != f"{pid}_record.mp3":
            raise ValueError(f"{pid}: invalid recording URL")
        if check_audio and expected["alignmentStatus"] == "ready":
            # This follows the browser's full CORS download, not native MP3 seeking.
            with http_response(audio_url, {"Origin": origin}, timeout=30) as response:
                if response.headers.get("Access-Control-Allow-Origin") not in ("*", origin):
                    raise ValueError(f"{pid}: MP3 download CORS does not permit this website")
                if response.headers.get_content_type() != "audio/mpeg":
                    raise ValueError(f"{pid}: recording is not served as audio/mpeg")
                digest = hashlib.file_digest(response, "sha256").hexdigest()
                if digest != expected["audioSha256"]:
                    raise ValueError(f"{pid}: deployed recording hash differs from approved audio")
    print(f"Website {version}: {len(approved)} approved chapters have exact deployed word timings")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--database", type=Path, default=DATABASE)
    parser.add_argument("--check-audio", action="store_true")
    parser.add_argument("--attempts", type=int, default=1)
    parser.add_argument("--interval", type=float, default=20)
    args = parser.parse_args()
    url = urlsplit(args.origin)
    if url.scheme not in ("http", "https") or not url.netloc or url.path not in ("", "/"):
        parser.error("Origin must be an HTTP(S) origin without a path")
    if args.attempts < 1 or args.interval < 0:
        parser.error("Attempts must be positive and interval nonnegative")
    for attempt in range(args.attempts):
        try:
            verify(args.origin.rstrip('/'), args.version, args.database, args.check_audio)
            return
        except (ValueError, OSError, HTTPException) as error:
            if attempt + 1 == args.attempts:
                raise SystemExit(str(error)) from error
            print(f"Waiting for deployment ({attempt+1}/{args.attempts}): {error}", flush=True)
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
