"""Generate a local timing review page or import its reviewed corrections."""

import argparse
import json
from pathlib import Path

from alignment import load_chapters, text_hash, validate_timings, words_for
from recite import ROOT, audio_hash, export_database, write_json


def accept_review(manifest, corrections, words):
    for key in ("perekId", "audioSha256", "textSha256"):
        if corrections.get(key) != manifest[key]:
            raise ValueError(f"Review refers to a different {key}")
    if manifest["textSha256"] != text_hash(words):
        raise ValueError("Canonical JSON changed after alignment")
    rows = corrections.get("words", [])
    if not rows or not all(row.get("reviewed") is True for row in rows):
        raise ValueError("Every word must be listened to and reviewed")
    validate_timings(words, rows, manifest["durationMs"], require_complete=True)
    return {**manifest, "alignmentStatus": "ready", "reviewMethod": "manual",
            "words": [{key: row[key] for key in ("pasuk", "segment", "text", "startMs", "endMs")}
                      for row in rows]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--perek", required=True, type=int)
    parser.add_argument("--manifests", type=Path, default=ROOT / "web/bible-on-site/public/recitation")
    parser.add_argument("--output", type=Path, help="HTML review page to create")
    parser.add_argument("--corrections", type=Path, help="Reviewed JSON exported from the page")
    parser.add_argument("--recordings", type=Path, help="Required when importing corrections")
    args = parser.parse_args()
    if not 1 <= args.perek <= 929 or bool(args.output) == bool(args.corrections):
        parser.error("Specify a valid perek and exactly one of --output or --corrections")
    path = args.manifests / f"{args.perek}.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    words = words_for(load_chapters(ROOT / "web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json")[args.perek])
    if args.corrections:
        if not args.recordings:
            parser.error("--recordings is required to verify the reviewed audio")
        if audio_hash(args.recordings / f"{args.perek}_record.mp3") != manifest["audioSha256"]:
            raise ValueError("Recording changed after alignment")
        reviewed = accept_review(manifest, json.loads(args.corrections.read_text(encoding="utf-8")), words)
        write_json(path, reviewed)
        export_database(args.manifests, Path(__file__).parent / ".outputs/recitation.sqlite")
        print(f"{args.perek}: published all {len(words)} reviewed word timings")
    else:
        template = Path(__file__).with_name("review.html").read_text(encoding="utf-8")
        payload = json.dumps(manifest, ensure_ascii=False).replace("<", "\\u003c")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(template.replace("__MANIFEST__", payload), encoding="utf-8")
        print(args.output.resolve())


if __name__ == "__main__":
    main()
