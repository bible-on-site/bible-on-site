"""Prepare and serve source-bound verse listening; never publish alignment data."""

import argparse
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess  # nosec B404: fixed FFmpeg argv, no shell.
import threading
import wave

from alignment import load_chapters, text_hash, validate_timings, words_for

RATE = 16000
ALIGN_REVISION = "b2e683004903f1b11bee2c6092a7c323ed858d82"


def digest_file(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def digest_json(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(",", ":")).encode()).hexdigest()


def candidate_digest(case):
    keys = ("perekId", "pasuk", "audioSha256", "textSha256", "clipStartMs",
            "clipEndMs", "words", "diagnosticSha256")
    return digest_json({key: case[key] for key in keys})


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def hebrew_number(number):
    result = ""
    for value, letter in ((400, "ת"), (300, "ש"), (200, "ר"), (100, "ק")):
        while number >= value:
            result += letter
            number -= value
    if number in (15, 16):
        return result + ("טו" if number == 15 else "טז")
    for value, letter in ((90, "צ"), (80, "פ"), (70, "ע"), (60, "ס"), (50, "נ"),
                          (40, "מ"), (30, "ל"), (20, "כ"), (10, "י"),
                          (9, "ט"), (8, "ח"), (7, "ז"), (6, "ו"),
                          (5, "ה"), (4, "ד"), (3, "ג"), (2, "ב"), (1, "א")):
        while number >= value:
            result += letter
            number -= value
    return result


def chapter_labels(canonical):
    labels = {}
    for book in read_json(canonical):
        for part in book.get("additionals", [book]):
            for index, chapter in enumerate(part["perakim"], 1):
                labels[chapter["perekId"]] = f'{part["name"]} {hebrew_number(index)}'
    return labels


def validate_case(case, canonical_words, manifest):
    if case["audioSha256"] != manifest["audioSha256"]:
        raise ValueError("Diagnostic source differs from saved alignment")
    if case["textSha256"] != text_hash(canonical_words):
        raise ValueError("Canonical chapter changed")
    verse_words = [word for word in canonical_words if word.pasuk == case["pasuk"]]
    if not verse_words:
        raise ValueError("Unknown canonical verse")
    validate_timings(verse_words, case["words"], manifest["durationMs"], require_complete=True)
    start, end = case["clipStartMs"], case["clipEndMs"]
    if (not isinstance(start, int) or isinstance(start, bool) or
            not isinstance(end, int) or isinstance(end, bool) or
            not 0 <= start < end <= manifest["durationMs"] or end - start > 45000):
        raise ValueError("Context must be inside the original recording and at most 45 seconds")
    for word in case["words"]:
        if not start <= word["startMs"] < word["endMs"] <= end:
            raise ValueError("Candidate falls outside its diagnostic context")
        if not 40 <= word["endMs"] - word["startMs"] <= 3000:
            raise ValueError("Candidate duration outside original quality limits")


def make_clip(audio, destination, start, end):
    """Trim decoded PCM by sample index, using the pipeline's 16 kHz time axis."""
    # Some originals change sample rate midstream. An atrim filter resets its
    # sample counter on reconfiguration, so decode first and slice the complete
    # PCM stream, just as the analysis pipeline does. Never seek in MP3 bytes.
    executable = shutil.which("ffmpeg")
    if executable is None:
        raise FileNotFoundError("FFmpeg not installed")
    decoded = subprocess.run([  # nosec B603: resolved FFmpeg, absolute input, no shell.  # nosemgrep
        executable, "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "2",
        "-i", str(audio.resolve()), "-ar", str(RATE), "-ac", "1", "-f", "s32le", "pipe:1",
    ], check=True, timeout=120, capture_output=True)
    first, last = start * 16 * 4, end * 16 * 4
    if len(decoded.stdout) < last:
        raise ValueError("Context extends beyond the fully decoded original recording")
    with wave.open(str(destination), "wb") as stream:
        stream.setparams((1, 4, RATE, 0, "NONE", "not compressed"))
        stream.writeframes(decoded.stdout[first:last])
    return decoded.stderr.decode("utf-8", errors="replace")

def prepare(args):
    canonical = args.canonical.resolve()
    chapters, labels = load_chapters(canonical), chapter_labels(canonical)
    held = {item["perekId"] for item in read_json(args.held_summary)["held"]}
    manifests = args.snapshot / "alignments"
    args.output.mkdir(parents=True, exist_ok=True)
    cases, excluded, source_hashes = {}, [], {}
    for path in sorted(args.diagnostics.glob("held-acoustic-study*.json")):
        study = read_json(path)
        if not study.get("diagnosticOnly") or study.get("revision") != ALIGN_REVISION:
            continue
        for diagnostic in study.get("cases", []):
            pid = diagnostic["perekId"]
            if pid not in held or not diagnostic.get("diagnosticCandidates"):
                continue
            try:
                manifest = read_json(manifests / f"{pid}.json")
                canonical_words = words_for(chapters[pid])
                if manifest["textSha256"] != text_hash(canonical_words):
                    raise ValueError("Saved alignment has stale canonical text")
                audio = args.recordings.resolve() / f"{pid}_record.mp3"
                source_hashes.setdefault(pid, digest_file(audio))
                if source_hashes[pid] != diagnostic["sourceAudioSha256"]:
                    raise ValueError("Original MP3 hash differs from diagnostic")
                for pasuk in sorted({row["pasuk"] for row in diagnostic["diagnosticCandidates"]}):
                    rows = [row for row in diagnostic["diagnosticCandidates"] if row["pasuk"] == pasuk]
                    case = {
                        "id": f"{pid}-{pasuk}", "perekId": pid, "pasuk": pasuk,
                        "label": f"{labels[pid]} {hebrew_number(pasuk)}",
                        "audioSha256": source_hashes[pid], "textSha256": text_hash(canonical_words),
                        "audioPath": str(audio), "manifestPath": str((manifests / f"{pid}.json").resolve()),
                        "diagnosticPath": str(path.resolve()), "diagnosticSha256": digest_file(path),
                        "clipStartMs": round(diagnostic["contextStartSec"] * 1000),
                        "clipEndMs": round(diagnostic["contextEndSec"] * 1000),
                        "words": rows, "originalReasons": diagnostic["originalReasons"],
                        "publicationStatus": "held",
                    }
                    validate_case(case, canonical_words, manifest)
                    case["candidateSha256"] = candidate_digest(case)
                    cases[case["id"]] = case
            except (KeyError, ValueError, OSError) as error:
                excluded.append({"file": path.name, "perekId": pid, "reason": str(error)})
    for case in cases.values():
        report = read_json(args.snapshot / f'{case["perekId"]}.review.json')
        hard = {row["pasuk"] for row in report["review"]
                if row["reason"] != "low acoustic score or implausible word duration"}
        case["heldVerseCount"] = len(hard)
    ordered = sorted(cases.values(), key=lambda case: (
        case["heldVerseCount"], len(case["words"]), case["perekId"], case["pasuk"]))
    if args.limit:
        ordered = ordered[:args.limit]
    for case in ordered:
        destination = args.output / f'{case["id"]}-{case["candidateSha256"]}.wav'
        case["decoderDiagnostics"] = make_clip(Path(case["audioPath"]), destination, case["clipStartMs"], case["clipEndMs"])
        case["clipPath"] = str(destination.resolve())
        case["clipSha256"] = digest_file(destination)
    queue = {"version": 1, "canonicalPath": str(canonical), "cases": ordered,
             "excluded": excluded, "publicationStatus": "held",
             "createdAt": datetime.now(timezone.utc).isoformat()}
    queue["queueSha256"] = digest_json(ordered)
    write_json(args.output / "queue.json", queue)
    print(f'Prepared {len(ordered)} verses; {len(excluded)} incomplete/stale contexts excluded', flush=True)


def load_queue(path):
    queue = read_json(path)
    if queue.get("version") != 1 or queue.get("publicationStatus") != "held":
        raise ValueError("Unknown listening queue")
    if digest_json(queue["cases"]) != queue["queueSha256"]:
        raise ValueError("Queue changed after preparation")
    chapters = load_chapters(Path(queue["canonicalPath"]))
    sources = {}
    for case in queue["cases"]:
        if candidate_digest(case) != case["candidateSha256"]:
            raise ValueError("Candidate changed after diagnostic preparation")
        if digest_file(Path(case["diagnosticPath"])) != case["diagnosticSha256"]:
            raise ValueError("Diagnostic evidence changed")
        validate_case(case, words_for(chapters[case["perekId"]]), read_json(Path(case["manifestPath"])))
        source = Path(case["audioPath"])
        if source not in sources:
            sources[source] = digest_file(source)
        if sources[source] != case["audioSha256"] or digest_file(Path(case["clipPath"])) != case["clipSha256"]:
            raise ValueError("Original recording or lossless listening clip changed")
    if len({case["id"] for case in queue["cases"]}) != len(queue["cases"]):
        raise ValueError("Duplicate listening case")
    return queue


def validate_decision(case, payload):
    if payload.get("candidateSha256") != case["candidateSha256"]:
        raise ValueError("Review refers to a different candidate")
    if payload.get("verdict") not in ("good", "problem", "skip"):
        raise ValueError("Unknown listening decision")
    segments = payload.get("heardSegments", [])
    allowed = {word["segment"] for word in case["words"]}
    if (not isinstance(segments, list) or any(not isinstance(item, int) or isinstance(item, bool) for item in segments) or
            len(set(segments)) != len(segments) or not set(segments) <= allowed):
        raise ValueError("Listening evidence contains unknown/duplicate word identities")
    verse = payload.get("verseHeard") is True
    if payload["verdict"] == "good" and set(segments) != allowed:
        raise ValueError("Listen to every exact word cut before confirming")
    note = payload.get("note", "")
    if not isinstance(note, str) or len(note) > 2000:
        raise ValueError("Note must be text of at most 2000 characters")
    return {
        "caseId": case["id"], "perekId": case["perekId"], "pasuk": case["pasuk"],
        "audioSha256": case["audioSha256"], "textSha256": case["textSha256"],
        "candidateSha256": case["candidateSha256"], "clipSha256": case["clipSha256"],
        "verdict": payload["verdict"], "note": note.strip(),
        "listenEvidenceReportedByBrowser": {"verseHeard": verse, "heardSegments": sorted(segments)},
        "scope": "one-verse-candidate", "publicationStatus": "held",
        "candidateWords": case["words"], "diagnosticSha256": case.get("diagnosticSha256"),
        "reviewMethod": "human-listening-feedback",
        "savedAt": datetime.now(timezone.utc).isoformat(),
    }


class ReviewStore:
    def __init__(self, path, queue):
        """Resume verse feedback without modifying candidate or approved data."""
        self.path, self.queue = path, queue
        self.lock = threading.Lock()
        self.decisions = {}
        self.on_saved = None
        self.entries = read_json(path)["entries"] if path.exists() else []
        for row in self.entries:
            case = next((case for case in queue["cases"] if case["id"] == row["caseId"]), None)
            if case and row["candidateSha256"] == case["candidateSha256"]:
                self.decisions[row["caseId"]] = row

    def save(self, case, payload):
        row = validate_decision(case, payload)
        row["queueSha256"] = self.queue["queueSha256"]
        with self.lock:
            entries = [*self.entries, row]
            write_json(self.path, {"version": 1, "entries": entries})
            self.entries = entries
            self.decisions[case["id"]] = row
        if self.on_saved is not None:
            self.on_saved()
        return row

    def snapshot(self):
        with self.lock:
            return dict(self.decisions)

class ListeningHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def send(self, status, content, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def json_response(self, status, content):
        self.send(status, json.dumps(content, ensure_ascii=False).encode())

    def valid_host(self):
        return self.headers.get("Host") == self.server.origin.removeprefix("http://")

    def do_GET(self):
        if not self.valid_host():
            return self.json_response(403, {"error": "Loopback host required"})
        if self.path == "/":
            return self.send(200, self.server.template, "text/html; charset=utf-8")
        if self.path == "/api/queue":
            public = [{key: value for key, value in case.items() if not key.endswith("Path")}
                      for case in self.server.queue["cases"]]
            return self.json_response(200, {"cases": public, "token": self.server.token,
                                           "decisions": self.server.review_store.snapshot()})
        if self.path == "/api/recovery":
            return self.json_response(200, self.server.recovery.snapshot() if self.server.recovery else {})
        if self.path == "/api/archive":
            return self.json_response(200, self.server.archived_rounds)
        if self.path == "/archive":
            return self.send(200, Path(__file__).with_name("listening_archive.html").read_bytes(), "text/html; charset=utf-8")
        if self.path == "/api/export":
            return self.json_response(200, {"queueSha256": self.server.queue["queueSha256"],
                                           "decisions": self.server.review_store.snapshot(),
                                           "publicationStatus": "held"})
        if self.path.startswith("/clips/"):
            case = self.server.cases.get(self.path.removeprefix("/clips/"))
            if case:
                data = Path(case["clipPath"]).read_bytes()
                if hashlib.sha256(data).hexdigest() != case["clipSha256"]:
                    return self.json_response(409, {"error": "Listening audio changed"})
                return self.send(200, data, "audio/wav")
        return self.json_response(404, {"error": "Not found"})


    def review_session_valid(self):
        return (self.valid_host() and self.headers.get("Origin") == self.server.origin and
                secrets.compare_digest(self.headers.get("X-Review-Token", "").encode(),
                                       self.server.token.encode()))

    def review_payload(self):
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 < size <= 16384 or self.headers.get("Content-Type") != "application/json":
            raise ValueError("Invalid review request")
        payload = json.loads(self.rfile.read(size))
        if not isinstance(payload, dict):
            raise ValueError("Expected a review object")
        case = self.server.cases.get(payload.get("caseId"))
        if case is None:
            raise ValueError("Unknown listening case")
        return case, payload

    def do_POST(self):
        if not self.review_session_valid():
            # Drain a bounded rejected body before closing, avoiding a TCP reset
            # that can hide the useful 403 response on Windows.
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if 0 < size <= 16384:
                    self.connection.settimeout(5)
                    self.rfile.read(size)
            except (ValueError, OSError):
                pass
            return self.json_response(403, {"error": "Local review session required"})
        if self.path != "/api/reviews":
            return self.json_response(404, {"error": "Not found"})
        try:
            case, payload = self.review_payload()
            row = self.server.review_store.save(case, payload)
            return self.json_response(200, row)
        except (ValueError, KeyError, TypeError) as error:
            return self.json_response(400, {"error": str(error)})
        except OSError:
            return self.json_response(500, {"error": "Could not save review; please retry"})


def make_server(queue, store, port, recovery=None):
    server = ThreadingHTTPServer(("127.0.0.1", port), ListeningHandler)
    server.recovery = recovery
    server.origin = f"http://127.0.0.1:{server.server_port}"
    server.token = secrets.token_urlsafe(32)
    server.template = Path(__file__).with_name("listening_review.html").read_bytes()
    server.queue = queue
    server.cases = {case["id"]: case for case in queue["cases"]}
    server.review_store = store
    server.archived_rounds = []
    for archive in queue.get("archivedQueues", []):
        path = Path(archive["path"])
        if digest_file(path) != archive["sha256"]:
            raise ValueError("Completed archive changed")
        archived = load_queue(path)
        decisions = ReviewStore(store.path, archived).snapshot()
        server.archived_rounds.append({"caseCount": len(archived["cases"]),
            "cases": [{"id": case["id"], "label": case["label"],
                       "decision": decisions.get(case["id"])} for case in archived["cases"]]})
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("prepare")
    for name in ("canonical", "snapshot", "diagnostics", "held-summary", "recordings", "output"):
        build.add_argument(f"--{name}", type=Path, required=True)
    build.add_argument("--limit", type=int, default=0)
    serve = commands.add_parser("serve")
    serve.add_argument("--queue", type=Path, required=True)
    serve.add_argument("--reviews", type=Path, required=True)
    serve.add_argument("--port", type=int, default=8766)
    serve.add_argument("--check-only", action="store_true")
    serve.add_argument("--recovery-database", type=Path)
    serve.add_argument("--recovery-output", type=Path)
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args)
    else:
        queue = load_queue(args.queue)
        if args.check_only:
            print(f"Verified {len(queue['cases'])} source-bound verse candidates", flush=True)
            return
        store = ReviewStore(args.reviews, queue)
        recovery = None
        if bool(args.recovery_database) != bool(args.recovery_output):
            parser.error("Both recovery preview paths are required")
        if args.recovery_database:
            from listening_monitor import RecoveryMonitor
            recovery = RecoveryMonitor(args.queue, args.reviews, Path(queue["canonicalPath"]),
                                       args.recovery_output, args.recovery_database)
            store.on_saved = recovery.notify
            recovery.start()
        server = make_server(queue, store, args.port, recovery)
        print(f"http://127.0.0.1:{server.server_port}/ - {len(queue['cases'])} verses", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            # Ctrl+C is normal shutdown; the finally block closes the server.
            pass
        finally:
            if recovery:
                recovery.close()
            server.server_close()


if __name__ == "__main__":
    main()
