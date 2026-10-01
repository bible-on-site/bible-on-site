"""Resumable local GPU recitation pipeline. Run --help for usage."""

import argparse
from contextlib import closing
import hashlib
import json
import math
from pathlib import Path
import sqlite3
import shutil
import subprocess
import time
import tempfile

from alignment import load_chapters, normalize, reconcile, text_hash, validate_timings, words_for

ROOT = Path(__file__).resolve().parents[2]
ASR_MODEL = "ivrit-ai/whisper-large-v3"
ALIGN_MODEL = "imvladikon/wav2vec2-xls-r-300m-hebrew"
PIPELINE_VERSION = 2


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def audio_hash(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def duration(path):
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,codec_name,sample_rate,channels",
        "-of", "json", str(path),
    ], text=True))
    streams = [s for s in probe["streams"] if s["codec_type"] == "audio"]
    if len(streams) != 1 or streams[0]["codec_name"] != "mp3":
        raise ValueError(f"{path.name}: expected one browser-compatible MP3 audio stream")
    result = round(float(probe["format"]["duration"]) * 1000)
    if result <= 0:
        raise ValueError(f"{path.name}: invalid audio duration")
    return result


def decode(path):
    import numpy as np
    data = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le",
        "-ac", "1", "-ar", "16000", "-",
    ])
    return np.frombuffer(data, dtype=np.float32).copy()


def transcribe(audio, args):
    import torch
    from transformers import pipeline

    # Full large-v3, no quantization or speed-oriented distilled/turbo model.
    # Native long-form decoding avoids externally cutting words at chunk edges.
    print(f"Loading {args.asr_model} on {args.device} (float32)", flush=True)
    model = pipeline("automatic-speech-recognition", model=args.asr_model,
                     device=args.device, dtype=torch.float32)
    print(f"Transcribing {len(audio)/16000:.1f}s; beam search=5; word timestamps enabled", flush=True)
    result = model({"raw": audio, "sampling_rate": 16000}, return_timestamps="word",
                   generate_kwargs={"language": "he", "task": "transcribe", "num_beams": 5})
    recognized = []
    for chunk in result["chunks"]:
        start, end = chunk["timestamp"]
        text = normalize(chunk["text"])
        if text and start is not None and end is not None and 0 <= start < end:
            recognized.append({"text": text, "start": float(start), "end": float(end)})
    del model
    if args.device == "cuda":
        torch.cuda.empty_cache()
    return recognized


def align_track(audio, words, recognized, aligner, args):
    matches = reconcile([w.speech for w in words], [w["text"] for w in recognized])
    reviews = []
    candidates = {(w.pasuk, w.segment): {"pasuk": w.pasuk, "segment": w.segment,
                  "text": w.text, "startMs": None, "endMs": None} for w in words}
    verses = sorted({w.pasuk for w in words})
    previous_end = 0
    for pasuk in verses:
        indices = [i for i, w in enumerate(words) if w.pasuk == pasuk]
        anchors = [(i, matches[i][0], matches[i][1]) for i in indices
                   if matches[i][0] and matches[i][1] >= args.min_text_score]
        coverage = len(anchors) / len(indices)
        problem = None
        if coverage < args.min_coverage or not anchors:
            problem = "insufficient ASR agreement"
        elif anchors[0][0] != indices[0] or anchors[-1][0] != indices[-1]:
            problem = "verse boundary words lack reliable ASR anchors"
        if problem:
            reviews.append({"pasuk": pasuk, "reason": problem, "anchorCoverage": coverage})
            continue
        first = recognized[anchors[0][1][0]]["start"]
        last = recognized[anchors[-1][1][-1]]["end"]
        start = max(previous_end / 1000, first - 0.35, 0)
        end = min(len(audio) / 16000, last + 0.35)
        if end - start > 45 or end <= start:
            reviews.append({"pasuk": pasuk, "reason": "verse window outside supported 0–45 seconds"})
            continue
        try:
            aligned = aligner.align(audio[int(start * 16000):int(end * 16000)],
                                    [words[i].speech for i in indices])
            rows = []
            for i, (left, right, score) in zip(indices, aligned, strict=True):
                word = words[i]
                rows.append({"pasuk": word.pasuk, "segment": word.segment, "text": word.text,
                             "startMs": round((start + left) * 1000),
                             "endMs": round((start + right) * 1000),
                             "acousticScore": round(score, 4),
                             "textScore": round(matches[i][1], 4)})
            suspect = [row for row in rows if row["acousticScore"] < args.min_acoustic_score or
                   row["endMs"] - row["startMs"] < 40 or
                   row["endMs"] - row["startMs"] > 3000]
            for row in rows:
                candidates[row["pasuk"], row["segment"]] = row
            if suspect:
                reviews.append({"pasuk": pasuk, "reason": "low acoustic score or implausible word duration",
                                "anchorCoverage": coverage, "suspectWords": suspect, "candidateWords": rows})
                continue
            validate_timings([words[i] for i in indices], rows, round(len(audio) / 16))
            previous_end = rows[-1]["endMs"]
        except ValueError as error:
            reviews.append({"pasuk": pasuk, "reason": str(error), "anchorCoverage": coverage})
    return list(candidates.values()), reviews


def export_database(output, database):
    """Atomically update the durable intermediate DB; a partial run preserves other tracks."""
    database.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=database.parent, suffix=".sqlite", delete=False) as handle:
        temporary = Path(handle.name)
    try:
        if database.exists():
            shutil.copy2(database, temporary)
        _export_database(output, temporary)
        temporary.replace(database)
    finally:
        temporary.unlink(missing_ok=True)


def _export_database(output, database):
    with closing(sqlite3.connect(database)) as db, db:
        if db.execute("PRAGMA user_version").fetchone()[0] not in (0, 3):
            raise ValueError("Unsupported recitation database version")
        db.executescript("""
            PRAGMA foreign_keys = ON;
            PRAGMA user_version = 3;
            CREATE TABLE IF NOT EXISTS recitation_track (
              perek_id INTEGER PRIMARY KEY, audio_url TEXT NOT NULL,
              audio_sha256 TEXT NOT NULL, text_sha256 TEXT NOT NULL, duration_ms INTEGER NOT NULL,
              alignment_status TEXT NOT NULL CHECK (alignment_status IN ('pending', 'needs_review', 'ready')),
              provenance_json TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS recitation_word (
              perek_id INTEGER NOT NULL REFERENCES recitation_track(perek_id),
              pasuk INTEGER NOT NULL, segment INTEGER NOT NULL,
              start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
              PRIMARY KEY (perek_id, pasuk, segment),
              CHECK (start_ms >= 0 AND end_ms > start_ms));
        """)
        core = {"version", "perekId", "audioUrl", "audioSha256", "textSha256", "durationMs", "alignmentStatus", "words"}
        for path in sorted(output.glob("[0-9]*.json")):
            manifest = json.loads(path.read_text(encoding="utf-8"))
            perek = manifest["perekId"]
            existing = db.execute("SELECT alignment_status,audio_sha256,text_sha256 FROM recitation_track WHERE perek_id=?", (perek,)).fetchone()
            if existing == ("ready", manifest["audioSha256"], manifest["textSha256"]) and manifest["alignmentStatus"] != "ready":
                continue
            db.execute("DELETE FROM recitation_word WHERE perek_id=?", (perek,))
            db.execute("""INSERT INTO recitation_track VALUES (?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(perek_id) DO UPDATE SET audio_url=excluded.audio_url,
                       audio_sha256=excluded.audio_sha256,text_sha256=excluded.text_sha256,
                       duration_ms=excluded.duration_ms,alignment_status=excluded.alignment_status,
                       provenance_json=excluded.provenance_json""",
                       (perek, manifest["audioUrl"], manifest["audioSha256"],
                        manifest["textSha256"], manifest["durationMs"], manifest["alignmentStatus"],
                        json.dumps({k: v for k, v in manifest.items() if k not in core}, ensure_ascii=False)))
            if manifest["alignmentStatus"] == "ready":
                from alignment import Word
                words = [Word(w["pasuk"], w["segment"], w["text"]) for w in manifest["words"]]
                validate_timings(words, manifest["words"], manifest["durationMs"], require_complete=True)
                db.executemany("INSERT INTO recitation_word VALUES (?, ?, ?, ?, ?)",
                               [(perek, w["pasuk"], w["segment"], w["startMs"], w["endMs"])
                                for w in manifest["words"]])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recordings", type=Path, required=True)
    parser.add_argument("--text", type=Path, default=ROOT / "web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / ".outputs/alignments")
    parser.add_argument("--cache", type=Path, default=Path(__file__).parent / ".outputs")
    parser.add_argument("--audio-base-url", default="https://bible-on-site-assets.s3.il-central-1.amazonaws.com/recordings")
    parser.add_argument("--perek", type=int, nargs="+", help="Only process these 929 perek IDs")
    parser.add_argument("--prepare-only", action="store_true", help="Catalog chapter playback without guessing word timings")
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    parser.add_argument("--asr-model", default=ASR_MODEL)
    parser.add_argument("--align-model", default=ALIGN_MODEL)
    parser.add_argument("--min-text-score", type=float, default=0.6)
    parser.add_argument("--min-acoustic-score", type=float, default=0.5)
    parser.add_argument("--min-coverage", type=float, default=0.85)
    parser.add_argument("--force", action="store_true", help="Recompute completed alignments")
    args = parser.parse_args()
    for value in (args.min_text_score, args.min_acoustic_score, args.min_coverage):
        if not math.isfinite(value) or not 0 <= value <= 1:
            parser.error("Quality thresholds must be between zero and one")
    if args.perek and any(not 1 <= p <= 929 for p in args.perek):
        parser.error("Perek IDs must be between 1 and 929")
    from publish import extract, publish
    chapters = load_chapters(args.text)
    files = sorted(args.recordings.glob("*_record.mp3"), key=lambda p: int(p.stem.split("_")[0]))
    if not files:
        parser.error("No *_record.mp3 recordings found")
    if args.perek:
        missing = set(args.perek) - {int(p.stem.split("_")[0]) for p in files}
        if missing:
            parser.error(f"No recording for requested perek IDs: {sorted(missing)}")
    config = {"version": PIPELINE_VERSION, "asrModel": args.asr_model, "alignModel": args.align_model,
              "minTextScore": args.min_text_score, "minAcousticScore": args.min_acoustic_score,
              "minCoverage": args.min_coverage}
    failures = []
    for path in files:
        perek_id = int(path.stem.split("_")[0])
        if args.perek and perek_id not in args.perek:
            continue
        if perek_id not in chapters:
            raise ValueError(f"Unknown perek filename: {path.name}")
        began = time.monotonic()
        print(f"{perek_id}: checking source audio and canonical words", flush=True)
        words = words_for(chapters[perek_id])
        fingerprint = audio_hash(path)
        output = args.output / f"{perek_id}.json"
        report = args.cache / f"{perek_id}.review.json"
        existing = json.loads(output.read_text(encoding="utf-8")) if output.exists() else extract(perek_id, chapters[perek_id])
        same = (existing and existing["audioSha256"] == fingerprint and existing["textSha256"] == text_hash(words)
                and existing["audioUrl"] == f"{args.audio_base_url.rstrip('/')}/{path.name}")
        if same and existing.get("alignmentStatus") and (args.prepare_only or (existing.get("pipeline") == config and not args.force)):
            if existing["alignmentStatus"] == "ready":
                validate_timings(words, existing["words"], existing["durationMs"], require_complete=True)
            print(f"{perek_id}: already processed", flush=True)
            continue
        manifest = {"version": 1, "perekId": perek_id,
                    "audioUrl": f"{args.audio_base_url.rstrip('/')}/{path.name}",
                    "audioSha256": fingerprint, "textSha256": text_hash(words),
                    "durationMs": duration(path), "alignmentStatus": "pending",
                    "words": [{"pasuk": w.pasuk, "segment": w.segment, "text": w.text,
                               "startMs": None, "endMs": None} for w in words]}
        if not args.prepare_only:
            try:
                audio = decode(path)
                asr_cache = args.cache / f"{perek_id}.asr.json"
                cached = json.loads(asr_cache.read_text(encoding="utf-8")) if asr_cache.exists() else None
                if cached and cached["audioSha256"] == fingerprint and cached["model"] == args.asr_model:
                    print(f"{perek_id}: reusing matching full ASR result", flush=True)
                    recognized = cached["words"]
                else:
                    recognized = transcribe(audio, args)
                    write_json(asr_cache, {"audioSha256": fingerprint, "model": args.asr_model, "words": recognized})
                from acoustic import HebrewAligner
                print(f"{perek_id}: aligning every canonical word with {args.align_model}", flush=True)
                aligner = HebrewAligner(args.align_model, args.device)
                manifest["words"], reviews = align_track(audio, words, recognized, aligner, args)
                del aligner
                manifest["pipeline"] = config
                manifest["alignmentStatus"] = "needs_review" if reviews else "ready"
                write_json(report, {"perekId": perek_id, "audioSha256": fingerprint,
                                    "textSha256": manifest["textSha256"], "pipeline": config,
                                    "totalWords": len(words), "words": manifest["words"], "review": reviews})
            except Exception as error:
                failures.append({"perekId": perek_id, "error": str(error)})
                print(f"{perek_id}: FAILED: {error}", flush=True)
                # A failed rerun must not replace a previously validated artifact.
                continue
        if manifest["alignmentStatus"] == "ready":
            validate_timings(words, manifest["words"], manifest["durationMs"], require_complete=True)
        elif len(manifest["words"]) != len(words):
            raise ValueError("Every database word must remain in pending and review outputs")
        write_json(output, manifest)
        print(f"{perek_id}: {len(manifest['words'])}/{len(words)} word identities; {manifest['alignmentStatus']}; {time.monotonic()-began:.1f}s", flush=True)
    export_database(args.output, Path(__file__).parent / "recitation.sqlite")
    from publish import publish
    publish(Path(__file__).parent / "recitation.sqlite", args.text)
    write_json(args.cache / "failures.json", failures)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
