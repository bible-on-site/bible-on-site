"""Resumable local GPU recitation pipeline. Run --help for usage."""

import argparse
import gc
from contextlib import closing
import hashlib
import json
import math
import re
from pathlib import Path
import sqlite3
import shutil
import subprocess  # nosec B404: FFmpeg uses an argument vector with no shell.
import time
import tempfile

from alignment import load_chapters, normalize, reconcile, text_hash, validate_timings, words_for

from model_versions import ALIGN_MODEL, ALIGN_REVISION, ASR_MODEL, ASR_REVISION

ROOT = Path(__file__).resolve().parents[2]
PIPELINE_VERSION = 3


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def audio_hash(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def executable(name):
    resolved = shutil.which(name)
    if resolved is None:
        raise FileNotFoundError(f"Required executable not found on PATH: {name}")
    return str(Path(resolved).resolve())


def cached_transcript(cached, fingerprint, model, revision):
    return (cached is not None and cached.get("audioSha256") == fingerprint
            and cached.get("model") == model and cached.get("revision") == revision)


def completed_alignment(existing, config, force):
    if not existing or force:
        return False
    # A model update must not silently replace a human-approved recording.
    reviewed = existing.get("alignmentStatus") == "ready" and existing.get("reviewMethod")
    return bool(reviewed or existing.get("pipeline") == config)


def duration(path):
    probe = json.loads(subprocess.check_output([  # nosec B603: fixed executable, argv only; source paths are absolute.
        executable("ffprobe"), "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,codec_name,sample_rate,channels",
        "-of", "json", str(path.resolve()),
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
    data = subprocess.check_output([  # nosec B603: fixed executable, argv only; source paths are absolute.
        executable("ffmpeg"), "-v", "error", "-i", str(path.resolve()), "-f", "f32le",
        "-ac", "1", "-ar", "16000", "-",
    ])
    return np.frombuffer(data, dtype=np.float32).copy()


def transcribe(audio, args):
    import torch
    from transformers import pipeline
    from transformers.utils import logging
    from whisper_memory import bounded_whisper_memory

    logging.disable_progress_bar()
    model = None
    try:
        # Full large-v3, FP32, native long-form decoding, and five beams throughout.
        print(f"Loading {args.asr_model} on {args.device} (float32)", flush=True)
        model = pipeline("automatic-speech-recognition", model=args.asr_model,
                         device=args.device, dtype=torch.float32, revision=args.asr_revision)
        options = {"language": "he", "task": "transcribe", "num_beams": 5,
                   "monitor_progress": report_asr_progress}
        if args.device == "cuda":
            # Whisper reads cross-attention cache layers directly after the first
            # token. Our hooks handle both caches, including those direct reads.
            options["cache_implementation"] = "dynamic"
            torch.cuda.reset_peak_memory_stats()
        print(f"Transcribing {len(audio)/16000:.1f}s; beam search=5; word timestamps enabled", flush=True)
        with bounded_whisper_memory(model.model):
            result = model({"raw": audio, "sampling_rate": 16000}, return_timestamps="word",
                           generate_kwargs=options)
        recognized = []
        for chunk in result["chunks"]:
            start, end = chunk["timestamp"]
            text = normalize(chunk["text"])
            if text and start is not None and end is not None and 0 <= start < end:
                recognized.append({"text": text, "start": float(start), "end": float(end)})
        if args.device == "cuda":
            print(f"Peak CUDA allocation: {torch.cuda.max_memory_allocated()/1024**3:.2f} GiB", flush=True)
        return recognized
    finally:
        model = None
        gc.collect()
        if args.device == "cuda":
            torch.cuda.empty_cache()


def report_asr_progress(progress):
    frames = progress.detach().cpu().tolist()
    print("ASR progress: " + ", ".join(f"{done/100:.1f}/{total/100:.1f}s" for done, total in frames), flush=True)


def joint_verse_overlaps(audio, words, matches, candidates, windows, aligner, args, reviews):
    """Resolve competing verse windows with one acoustic path, never timestamp padding."""
    tried = set()
    for _ in range(len(windows)):
        rows = [candidates[w.pasuk, w.segment] for w in words]
        conflict = next(((left, right) for left, right in zip(rows, rows[1:])
            if left["endMs"] is not None and right["startMs"] is not None
            and left["endMs"] > right["startMs"]
            and (left["pasuk"], right["pasuk"]) not in tried), None)
        if conflict is None:
            break
        pair = (conflict[0]["pasuk"], conflict[1]["pasuk"])
        tried.add(pair)
        indices = [i for i, word in enumerate(words) if word.pasuk in pair]
        if len(set(pair)) != 2 or any(pasuk not in windows for pasuk in pair):
            continue
        start = min(windows[pasuk][0] for pasuk in pair)
        end = max(windows[pasuk][1] for pasuk in pair)
        if end - start > 45:
            reviews.append({"pasuk": pair[1], "reason": "overlapping verse windows exceed the joint 45-second limit"})
            continue
        try:
            aligned = aligner.align(audio[int(start * 16000):int(end * 16000)],
                                    [words[i].speech for i in indices])
            revised = [{"pasuk": words[i].pasuk, "segment": words[i].segment, "text": words[i].text,
                "startMs": round((start + left) * 1000), "endMs": round((start + right) * 1000),
                "acousticScore": round(score, 4), "textScore": round(matches[i][1], 4)}
                for i, (left, right, score) in zip(indices, aligned, strict=True)]
            validate_timings([words[i] for i in indices], revised, round(len(audio) / 16), require_complete=True)
        except ValueError as error:
            reviews.append({"pasuk": pair[1], "reason": f"joint verse alignment failed: {error}"})
            continue
        for row in revised:
            candidates[row["pasuk"], row["segment"]] = row
        reviews[:] = [review for review in reviews if review["pasuk"] not in pair]
        for pasuk in pair:
            verse = [row for row in revised if row["pasuk"] == pasuk]
            suspect = suspect_rows(verse, args)
            if suspect:
                coverage = sum(bool(matches[i][0]) and matches[i][1] >= args.min_text_score
                    for i in indices if words[i].pasuk == pasuk) / len(verse)
                reviews.append({"pasuk": pasuk, "reason": "low acoustic score or implausible word duration",
                    "anchorCoverage": coverage, "suspectWords": suspect, "candidateWords": verse})
    rows = [candidates[w.pasuk, w.segment] for w in words]
    for left, right in zip(rows, rows[1:]):
        if left["endMs"] is not None and right["startMs"] is not None and left["endMs"] > right["startMs"]:
            reviews.append({"pasuk": right["pasuk"], "reason": "verse timings still overlap after joint alignment"})


def suspect_rows(rows, args):
    return [row for row in rows if row["acousticScore"] < args.min_acoustic_score or
            row["endMs"] - row["startMs"] < 40 or row["endMs"] - row["startMs"] > 3000]


def align_track(audio, words, recognized, aligner, args):
    matches = reconcile([w.speech for w in words], [w["text"] for w in recognized])
    reviews = []
    windows = {}
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
        windows[pasuk] = (start, end)
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
            suspect = suspect_rows(rows, args)
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
    joint_verse_overlaps(audio, words, matches, candidates, windows, aligner, args, reviews)
    return list(candidates.values()), reviews


def export_database(output, database):
    """Atomically update the durable intermediate DB; a partial run preserves other tracks."""
    database.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=database.parent, suffix=".sqlite", delete=False) as handle:
        handle.flush()
    temporary = Path(handle.name)
    try:
        if database.exists():
            shutil.copy2(database, temporary)
        _export_database(output, temporary)
        temporary.replace(database)
    finally:
        temporary.unlink(missing_ok=True)


def _export_database(output, database):
    with closing(sqlite3.connect(database)) as db:
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
        db.commit()


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recordings", type=Path, required=True)
    parser.add_argument("--text", type=Path, default=ROOT / "web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / ".outputs/alignments")
    parser.add_argument("--cache", type=Path, default=Path(__file__).parent / ".outputs")
    parser.add_argument("--database", type=Path, default=Path(__file__).parent / "recitation.sqlite",
                        help="Intermediate database checkpointed after each track")
    parser.add_argument("--shortest-first", action="store_true", help="Process shorter chapters first without changing inference")
    parser.add_argument("--audio-base-url", default="https://bible-on-site-assets.s3.il-central-1.amazonaws.com/recordings")
    parser.add_argument("--perek", type=int, nargs="+", help="Only process these 929 perek IDs")
    parser.add_argument("--prepare-only", action="store_true", help="Catalog chapter playback without guessing word timings")
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    parser.add_argument("--asr-model", default=ASR_MODEL)
    parser.add_argument("--align-model", default=ALIGN_MODEL)
    parser.add_argument("--asr-revision", help="Exact model commit; required with a custom ASR model")
    parser.add_argument("--align-revision", help="Exact model commit; required with a custom alignment model")
    parser.add_argument("--min-text-score", type=float, default=0.6)
    parser.add_argument("--min-acoustic-score", type=float, default=0.5)
    parser.add_argument("--min-coverage", type=float, default=0.85)
    parser.add_argument("--force", action="store_true", help="Recompute completed alignments")
    args = parser.parse_args()
    for kind, default_model, default_revision in (("asr", ASR_MODEL, ASR_REVISION), ("align", ALIGN_MODEL, ALIGN_REVISION)):
        revision = getattr(args, f"{kind}_revision")
        if revision is None and getattr(args, f"{kind}_model") == default_model:
            revision = default_revision
        if revision is None or not re.fullmatch(r"[0-9a-f]{40}", revision):
            parser.error(f"--{kind}-revision must identify an exact 40-character model commit")
        setattr(args, f"{kind}_revision", revision)
    for value in (args.min_text_score, args.min_acoustic_score, args.min_coverage):
        if not math.isfinite(value) or not 0 <= value <= 1:
            parser.error("Quality thresholds must be between zero and one")
    if args.perek and any(not 1 <= p <= 929 for p in args.perek):
        parser.error("Perek IDs must be between 1 and 929")
    return parser, args


def source_files(parser, args, chapters):
    files = sorted(args.recordings.glob("*_record.mp3"), key=lambda p: int(p.stem.split("_")[0]))
    if not files:
        parser.error("No *_record.mp3 recordings found")
    if args.perek:
        missing = set(args.perek) - {int(p.stem.split("_")[0]) for p in files}
        if missing:
            parser.error(f"No recording for requested perek IDs: {sorted(missing)}")
    selected = [path for path in files if not args.perek or int(path.stem.split("_")[0]) in args.perek]
    for path in selected:
        if int(path.stem.split("_")[0]) not in chapters:
            parser.error(f"Unknown perek filename: {path.name}")
    if args.shortest_first:
        selected.sort(key=lambda p: chapters[int(p.stem.split("_")[0])].get("recitation", {}).get("durationMs", math.inf))
    return selected


def source_matches(existing, fingerprint, words, url):
    if existing is None:
        return False
    return (existing["audioSha256"] == fingerprint and existing["textSha256"] == text_hash(words)
            and existing["audioUrl"] == url)


def align_manifest(path, words, fingerprint, manifest, report, config, args):
    perek_id = manifest["perekId"]
    audio = decode(path)
    asr_cache = args.cache / f"{perek_id}.asr.json"
    cached = json.loads(asr_cache.read_text(encoding="utf-8")) if asr_cache.exists() else None
    if cached_transcript(cached, fingerprint, args.asr_model, args.asr_revision):
        print(f"{perek_id}: reusing matching full ASR result", flush=True)
        recognized = cached["words"]
    else:
        recognized = transcribe(audio, args)
        write_json(asr_cache, {"audioSha256": fingerprint, "model": args.asr_model, "revision": args.asr_revision, "words": recognized})
    from acoustic import HebrewAligner
    print(f"{perek_id}: aligning every canonical word with {args.align_model}", flush=True)
    aligner = HebrewAligner(args.align_model, args.device, args.align_revision)
    manifest["words"], reviews = align_track(audio, words, recognized, aligner, args)
    del aligner
    manifest["pipeline"] = config
    manifest["alignmentStatus"] = "needs_review" if reviews else "ready"
    write_json(report, {"perekId": perek_id, "audioSha256": fingerprint,
                        "textSha256": manifest["textSha256"], "pipeline": config,
                        "totalWords": len(words), "words": manifest["words"], "review": reviews})


def process_track(path, chapters, config, args):
    from publish import extract
    perek_id = int(path.stem.split("_")[0])
    began = time.monotonic()
    print(f"{perek_id}: checking source audio and canonical words", flush=True)
    words = words_for(chapters[perek_id])
    fingerprint = audio_hash(path)
    output = args.output / f"{perek_id}.json"
    report = args.cache / f"{perek_id}.review.json"
    existing = json.loads(output.read_text(encoding="utf-8")) if output.exists() else extract(perek_id, chapters[perek_id])
    same = source_matches(existing, fingerprint, words, f"{args.audio_base_url.rstrip('/')}/{path.name}")
    if same and existing.get("alignmentStatus") and (args.prepare_only or completed_alignment(existing, config, args.force)):
        if existing["alignmentStatus"] == "ready":
            validate_timings(words, existing["words"], existing["durationMs"], require_complete=True)
        print(f"{perek_id}: already processed", flush=True)
        return None
    manifest = {"version": 1, "perekId": perek_id,
                "audioUrl": f"{args.audio_base_url.rstrip('/')}/{path.name}",
                "audioSha256": fingerprint, "textSha256": text_hash(words),
                "durationMs": duration(path), "alignmentStatus": "pending",
                "words": [{"pasuk": w.pasuk, "segment": w.segment, "text": w.text,
                           "startMs": None, "endMs": None} for w in words]}
    if not args.prepare_only:
        try:
            align_manifest(path, words, fingerprint, manifest, report, config, args)
        except Exception as error:
            print(f"{perek_id}: FAILED: {error}", flush=True)
            if isinstance(error, MemoryError) or "out of memory" in str(error).lower():
                raise MemoryError(f"Perek {perek_id}: inference ran out of memory; stopping the batch without reducing quality") from error
            # A failed rerun must not replace a previously validated artifact.
            return str(error)
    if manifest["alignmentStatus"] == "ready":
        validate_timings(words, manifest["words"], manifest["durationMs"], require_complete=True)
    elif len(manifest["words"]) != len(words):
        raise ValueError("Every database word must remain in pending and review outputs")
    write_json(output, manifest)
    print(f"{perek_id}: {len(manifest['words'])}/{len(words)} word identities; {manifest['alignmentStatus']}; {time.monotonic()-began:.1f}s", flush=True)
    return None


def main():
    from publish import publish
    parser, args = parse_arguments()
    chapters = load_chapters(args.text)
    files = source_files(parser, args, chapters)
    config = {"version": PIPELINE_VERSION, "asrModel": args.asr_model, "alignModel": args.align_model,
              "asrRevision": args.asr_revision, "alignRevision": args.align_revision,
              "minTextScore": args.min_text_score, "minAcousticScore": args.min_acoustic_score,
              "minCoverage": args.min_coverage}
    failures = []
    # Recover completed cache artifacts even when the previous run was interrupted.
    export_database(args.output, args.database)
    for path in files:
        try:
            error = process_track(path, chapters, config, args)
        except MemoryError as error:
            failures.append({"perekId": int(path.stem.split("_")[0]), "error": str(error)})
            write_json(args.cache / "failures.json", failures)
            break
        # Save durable progress before starting another expensive inference.
        export_database(args.output, args.database)
        if error is not None:
            failures.append({"perekId": int(path.stem.split("_")[0]), "error": error})
            write_json(args.cache / "failures.json", failures)
    publish(args.database, args.text)
    write_json(args.cache / "failures.json", failures)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
