"""Stage complete alignments after explicit approval of the pinned process."""

import argparse
from contextlib import closing
from copy import deepcopy
import json
import math
from pathlib import Path
import sqlite3
import tempfile

from alignment import load_chapters, reconcile, text_hash, validate_timings, words_for
from model_versions import ALIGN_MODEL, ALIGN_REVISION, ASR_MODEL, ASR_REVISION
from recite import ROOT, audio_hash, cached_transcript, duration, export_database, write_json

POLICY_VERSION = 1
TRUSTED_PIPELINE = {
    "version": 3, "asrModel": ASR_MODEL, "asrRevision": ASR_REVISION,
    "alignModel": ALIGN_MODEL, "alignRevision": ALIGN_REVISION,
    "minTextScore": .6, "minAcousticScore": .5, "minCoverage": .85,
}
SOFT_WARNING = "low acoustic score or implausible word duration"
AUDIO_BASE = "https://bible-on-site-assets.s3.il-central-1.amazonaws.com/recordings"


def valid_score(value):
    return (isinstance(value, (float, int)) and not isinstance(value, bool)
            and math.isfinite(value) and 0 <= value <= 1)


def verify_source(manifest, words, recording, duration_ms):
    if manifest.get("pipeline") != TRUSTED_PIPELINE:
        raise ValueError("Alignment does not use the approved pinned process")
    if manifest.get("alignmentStatus") not in ("ready", "needs_review"):
        raise ValueError("Alignment has not completed")
    if manifest.get("textSha256") != text_hash(words):
        raise ValueError("Canonical words changed after alignment")
    if manifest.get("audioSha256") != audio_hash(recording):
        raise ValueError("Recording changed after alignment")
    if manifest.get("audioUrl") != f"{AUDIO_BASE}/{manifest['perekId']}_record.mp3":
        raise ValueError("Playback URL does not refer to the verified recording")
    if manifest.get("durationMs") != duration_ms:
        raise ValueError("Recording duration changed after alignment")


def verify_evidence(manifest, report, cached, words, duration_ms):
    for key in ("perekId", "audioSha256", "textSha256", "pipeline", "words"):
        if report.get(key) != manifest.get(key):
            raise ValueError(f"Diagnostic report differs from alignment: {key}")
    if report.get("totalWords") != len(words) or not isinstance(report.get("review"), list):
        raise ValueError("Incomplete diagnostic report")
    if not cached_transcript(cached, manifest["audioSha256"], ASR_MODEL, ASR_REVISION):
        raise ValueError("ASR evidence has a different source or model snapshot")
    rows = manifest["words"]
    validate_timings(words, rows, duration_ms, require_complete=True)
    for row in rows:
        if not 40 <= row["endMs"] - row["startMs"] <= 3000:
            raise ValueError(f"Implausible word duration: {(row['pasuk'], row['segment'])}")
        if not all(valid_score(row.get(key)) for key in ("acousticScore", "textScore")):
            raise ValueError("Missing or invalid alignment evidence")


def verify_anchors(rows, words, recognized):
    matches = reconcile([word.speech for word in words], [word["text"] for word in recognized])
    for pasuk in sorted({word.pasuk for word in words}):
        indices = [i for i, word in enumerate(words) if word.pasuk == pasuk]
        anchors = [i for i in indices if matches[i][0] and matches[i][1] >= TRUSTED_PIPELINE["minTextScore"]]
        if (len(anchors) / len(indices) < TRUSTED_PIPELINE["minCoverage"]
                or indices[0] not in anchors or indices[-1] not in anchors):
            raise ValueError(f"Insufficient ASR anchors in pasuk {pasuk}")
        for i in indices:
            if rows[i]["textScore"] != round(matches[i][1], 4):
                raise ValueError("Text evidence differs from the verified ASR result")


def verify_warnings(rows, warnings):
    for warning in warnings:
        if warning.get("reason") != SOFT_WARNING:
            raise ValueError(f"Unresolved alignment failure: {warning.get('reason')}")
        verse = [row for row in rows if row["pasuk"] == warning.get("pasuk")]
        suspect = [row for row in verse if row["acousticScore"] < TRUSTED_PIPELINE["minAcousticScore"]]
        if (not suspect or warning.get("candidateWords") != verse
                or warning.get("suspectWords") != suspect
                or not valid_score(warning.get("anchorCoverage"))
                or warning["anchorCoverage"] < TRUSTED_PIPELINE["minCoverage"]):
            raise ValueError("Diagnostic warning contains more than a low acoustic score")


def approve_alignment(manifest, report, cached, words, recording, duration_ms):
    """Do not imply listening approval or modify a single acoustic boundary."""
    verify_source(manifest, words, recording, duration_ms)
    verify_evidence(manifest, report, cached, words, duration_ms)
    verify_anchors(manifest["words"], words, cached["words"])
    verify_warnings(manifest["words"], report["review"])
    accepted = deepcopy(manifest)
    accepted.update(alignmentStatus="ready", reviewMethod="trusted-process",
                    acceptancePolicy={"version": POLICY_VERSION, "diagnostics": deepcopy(report["review"])})
    return accepted


def stage_completed(manifests, reports, recordings, text, output, database):
    """Overlay only this run's validated chapters; never export stale staged files."""
    chapters = load_chapters(text)
    with closing(sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True)) as db:
        existing = {pid: (status, audio, canonical) for pid, status, audio, canonical in db.execute(
            "SELECT perek_id,alignment_status,audio_sha256,text_sha256 FROM recitation_track")}
    summary = {"accepted": [], "held": [], "alreadyPublished": []}
    with tempfile.TemporaryDirectory() as folder:
        staged = Path(folder)
        for path in sorted(manifests.glob("[0-9]*.json"), key=lambda p: int(p.stem)):
            manifest = json.loads(path.read_text(encoding="utf-8"))
            pid = manifest["perekId"]
            if existing.get(pid) == ("ready", manifest["audioSha256"], manifest["textSha256"]):
                summary["alreadyPublished"].append(pid)
                continue
            if manifest.get("alignmentStatus") == "pending":
                continue
            try:
                recording = recordings / f"{pid}_record.mp3"
                report = json.loads((reports / f"{pid}.review.json").read_text(encoding="utf-8"))
                cached = json.loads((reports / f"{pid}.asr.json").read_text(encoding="utf-8"))
                accepted = approve_alignment(manifest, report, cached, words_for(chapters[pid]), recording, duration(recording))
            except (ValueError, KeyError, TypeError, OSError) as error:
                summary["held"].append({"perekId": pid, "reason": str(error)})
                continue
            write_json(staged / path.name, accepted)
            write_json(output / path.name, accepted)
            summary["accepted"].append(pid)
        if summary["accepted"]:
            export_database(staged, database)
    write_json(output / "summary.json", summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recordings", type=Path, required=True)
    parser.add_argument("--manifests", type=Path, default=Path(__file__).parent / ".outputs/alignments")
    parser.add_argument("--reports", type=Path, default=Path(__file__).parent / ".outputs")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / ".outputs/trusted-delivery")
    parser.add_argument("--text", type=Path, default=ROOT / "web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json")
    parser.add_argument("--database", type=Path, default=Path(__file__).parent / "recitation.sqlite")
    args = parser.parse_args()
    print(json.dumps(stage_completed(args.manifests, args.reports, args.recordings, args.text, args.output, args.database), indent=2))


if __name__ == "__main__":
    main()
