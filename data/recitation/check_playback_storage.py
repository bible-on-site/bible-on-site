"""Verify public derived assets without writing to S3 or the alignment checkpoint."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen
from playback import MANIFEST, load_playback


def verify(perek_id, asset, base):
    load_playback(perek_id, asset["sourceSha256"])
    url = f'{base}/{asset["key"]}'
    origin = "https://xn--febl3a.co.il"
    with urlopen(Request(url, headers={"Origin": origin}), timeout=120) as response:
        audio = response.read()
        if (response.status != 200 or response.headers.get_content_type() != "audio/ogg"
                or response.headers.get("Access-Control-Allow-Origin") not in ("*", origin)
                or len(audio) != asset["sizeBytes"] or hashlib.sha256(audio).hexdigest() != asset["sha256"]
                or not audio.startswith(b"OggS")):
            raise ValueError(f"{perek_id}: public Opus payload mismatch")
    start = len(audio) // 2
    end = min(start + 1023, len(audio) - 1)
    with urlopen(Request(url, headers={"Range": f"bytes={start}-{end}"}), timeout=120) as response:
        if (response.status != 206 or response.headers.get_content_type() != "audio/ogg"
                or response.headers.get("Content-Range") != f"bytes {start}-{end}/{len(audio)}"
                or response.read() != audio[start:end + 1]):
            raise ValueError(f"{perek_id}: public Opus range mismatch")
    return {"perekId": int(perek_id), "sourceSha256": asset["sourceSha256"],
            "playbackSha256": asset["sha256"], "bytes": len(audio), "fullHashMimeCorsRange": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="https://bible-on-site-assets.s3.il-central-1.amazonaws.com")
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    inventory = json.loads(MANIFEST.read_text())
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda item: verify(*item, args.base), inventory["tracks"].items()))
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps({"verified": len(results), "tracks": results}, indent=2) + "\n")
    print(f"Verified {len(results)} public Opus files: full SHA, MIME, CORS and nonzero byte ranges")
