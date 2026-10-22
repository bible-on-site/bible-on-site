"""Separate append-only source-bound human actions; never approve publication data."""
from contextlib import closing
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import struct

from listening_review import digest_file, digest_json

POLICY = "source-bound-human-action-v1"
KINDS = {"locate-source-range", "source-remediation", "review-cuts"}
STATES = {"pending", "context_queued", "preparing", "review", "needs_source", "resolved"}
DECISIONS = {"source_problem", "cannot_locate", "request_corrected_source"}
HASH = r"[0-9a-f]{64}"
IDENTIFIER = r"[A-Za-z0-9_-]{1,128}"


def _integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _sha(value):
    return isinstance(value, str) and re.fullmatch(HASH, value) is not None


def _now():
    return datetime.now(timezone.utc).isoformat()


def task_digest(task):
    """Bind every immutable definition field, including the actual source profile."""
    return digest_json({key: value for key, value in task.items() if key != "taskSha256"})


def _validate_task_identity(task):
    """Check immutable action identity and its exact canonical verse label."""
    if not isinstance(task, dict):
        raise ValueError("Expected an immutable action definition")
    if (not isinstance(task.get("taskId"), str) or not re.fullmatch(IDENTIFIER, task["taskId"])
            or task.get("kind") not in KINDS or task.get("policy") != POLICY
            or not _integer(task.get("version")) or task["version"] != 1 or not _sha(task.get("taskSha256"))
            or task_digest(task) != task["taskSha256"]):
        raise ValueError("Action definition identity or policy changed")
    pid, verse = task.get("perekId"), task.get("pasuk")
    if not _integer(pid) or not _integer(verse) or pid < 1 or verse < 1:
        raise ValueError("Action requires an exact canonical verse")
    label = task.get("label")
    if not isinstance(label, str) or not re.fullmatch(r"[\u05d0-\u05ea0-9][\u05d0-\u05ea0-9 -]{0,159}", label):
        raise ValueError("Action requires a safe canonical display label")
    return pid, verse


def _validate_source_profile(task):
    """Require the complete bound original source and optional derived playback."""
    if (not _sha(task.get("audioSha256")) or not _sha(task.get("textSha256"))
            or not _sha(task.get("sourcePcmSha256")) or task.get("sourceSampleRate") != 16000
            or not _integer(task.get("sourceFrames")) or task["sourceFrames"] < 16):
        raise ValueError("Action requires the complete decoded original source profile")
    path = task.get("sourceAudioPath")
    if not isinstance(path, str) or not Path(path).is_absolute() or Path(path).suffix.lower() != ".mp3":
        raise ValueError("Action audio must be an absolute original MP3")
    if "sourcePlaybackPath" in task or "playbackSha256" in task:
        playback = task.get("sourcePlaybackPath")
        if (not isinstance(playback, str) or not Path(playback).is_absolute()
                or Path(playback).suffix.lower() != ".wav" or not _sha(task.get("playbackSha256"))):
            raise ValueError("Action playback requires a bound derived WAV")


def _validate_target_words(task, verse):
    """Keep actual canonical segment identities, including gaps for unspoken notes."""
    words = task.get("canonicalWords")
    if not isinstance(words, list) or not words:
        raise ValueError("Action requires canonical target words")
    previous_segment = 0
    for word in words:
        if (not isinstance(word, dict) or set(word) != {"pasuk", "segment", "text"}
                or not _integer(word.get("pasuk")) or not _integer(word.get("segment"))
                or word["pasuk"] != verse or word["segment"] <= previous_segment
                or not isinstance(word.get("text"), str) or not word["text"]):
            raise ValueError("Action canonical word identities are incomplete")
        previous_segment = word["segment"]
    return words


def _validate_chapter_concern(task, words):
    """Bind a new chapter concern to an actual prior review and target segments."""
    if "chapterConcern" in task:
        concern = task["chapterConcern"]
        allowed_segments = {word["segment"] for word in words}
        if (task["kind"] != "review-cuts" or not isinstance(concern, dict)
                or set(concern) != {"validationSha256", "previousReviewSha256", "reasonCode", "segments"}
                or not _sha(concern.get("validationSha256")) or not _sha(concern.get("previousReviewSha256"))
                or concern.get("reasonCode") not in {"cross_verse_overlap", "chapter_validation_failure"}
                or not isinstance(concern.get("segments"), list) or not concern["segments"]
                or any(not _integer(segment) or segment not in allowed_segments for segment in concern["segments"])
                or concern["segments"] != sorted(set(concern["segments"]))):
            raise ValueError("Chapter concern requires exact validated source-bound target segments")


def _validate_neighbors(task, verse):
    """Validate optional read-only adjacent canonical context without adding anchors."""
    if "neighborWords" in task:
        neighbors = task["neighborWords"]
        if (not isinstance(neighbors, list) or any(not isinstance(word, dict)
                or set(word) != {"pasuk", "segment", "text"}
                or not _integer(word.get("pasuk")) or abs(word["pasuk"] - verse) != 1
                or not _integer(word.get("segment")) or word["segment"] < 1
                or not isinstance(word.get("text"), str) or not word["text"] for word in neighbors)
                or len({(word["pasuk"], word["segment"]) for word in neighbors}) != len(neighbors)):
            raise ValueError("Display neighbors require exact adjacent canonical identities")


def _validate_task_references(task, pid, verse):
    """Require private immutable evidence and repository-bound review references."""
    if not isinstance(task.get("sourceEvidence"), dict) or not task["sourceEvidence"]:
        raise ValueError("Action requires immutable source evidence bindings")
    if task["kind"] == "review-cuts":
        ref = task.get("caseRef", {key: task.get(key) for key in
                                  ("caseId", "candidateSha256", "clipSha256")})
        _validate_case_ref(ref, pid, verse)
    for name in ("issueURL", "issueUrl"):
        if name in task and (not isinstance(task[name], str) or not re.fullmatch(
                r"https://github\.com/bible-on-site/bible-on-site/issues/[1-9][0-9]*", task[name])):
            raise ValueError("Action issue must use the repository issue tracker")


def validate_task(task):
    """Reject unbound tasks instead of manufacturing missing word coordinates."""
    pid, verse = _validate_task_identity(task)
    _validate_source_profile(task)
    words = _validate_target_words(task, verse)
    _validate_chapter_concern(task, words)
    _validate_neighbors(task, verse)
    _validate_task_references(task, pid, verse)
    return deepcopy(task)


def _validate_case_ref(ref, pid=None, verse=None):
    if (not isinstance(ref, dict) or set(ref) != {"caseId", "candidateSha256", "clipSha256"}
            or not isinstance(ref["caseId"], str)
            or not re.fullmatch(r"[1-9][0-9]*-[1-9][0-9]*", ref["caseId"])
            or not _sha(ref["candidateSha256"]) or not _sha(ref["clipSha256"])
            or pid is not None and ref["caseId"] != f"{pid}-{verse}"):
        raise ValueError("Review action requires an exact immutable candidate")
    return deepcopy(ref)


def playback_bytes(task):
    """Verify an unedited IEEE float32 WAV against the full original decoded PCM profile."""
    path = Path(task["sourcePlaybackPath"])
    before = path.stat()
    raw = path.read_bytes()
    after = path.stat()
    if ((before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns)
            or hashlib.sha256(raw).hexdigest() != task["playbackSha256"]
            or len(raw) < 44 or raw[:4] != b"RIFF" or raw[8:12] != b"WAVE"
            or struct.unpack_from("<I", raw, 4)[0] + 8 != len(raw)):
        raise ValueError("Action full-source playback changed")
    chunks, offset = {}, 12
    while offset + 8 <= len(raw):
        kind, length = raw[offset:offset + 4], struct.unpack_from("<I", raw, offset + 4)[0]
        first, end = offset + 8, offset + 8 + length
        if end > len(raw) or kind in chunks:
            raise ValueError("Action playback has malformed WAV chunks")
        chunks[kind] = raw[first:end]
        offset = end + length % 2
    fmt, pcm = chunks.get(b"fmt ", b""), chunks.get(b"data", b"")
    if (offset != len(raw) or len(fmt) < 16
            or struct.unpack_from("<HHIIHH", fmt) != (3, 1, 16000, 64000, 4, 32)
            or len(pcm) != task["sourceFrames"] * 4
            or hashlib.sha256(pcm).hexdigest() != task["sourcePcmSha256"]):
        raise ValueError("Action playback differs from complete original decoded PCM")
    return raw

def validate_response(task, payload):
    """A location is explicit human input, never a GOOD verdict or word hearing."""
    if not isinstance(payload, dict):
        raise ValueError("Expected an action response")
    identifier = payload.get("submissionId")
    if not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", identifier):
        raise ValueError("A unique action submission identity is required")
    for key in ("taskId", "taskSha256", "audioSha256", "textSha256"):
        if payload.get(key) != task[key]:
            raise ValueError("Action response refers to stale source or task evidence")
    common = {"submissionId", "taskId", "taskSha256", "audioSha256", "textSha256", "kind", "note"}
    note = payload.get("note", "")
    if not isinstance(note, str) or len(note) > 2000:
        raise ValueError("Action note must be at most 2000 characters")
    if payload.get("kind") == "locate-source-range" and task["kind"] in {"locate-source-range", "review-cuts"}:
        if not set(payload) <= common | {"startMs", "endMs", "heardRange"}:
            raise ValueError("Unknown source-location response field")
        start, end, heard = payload.get("startMs"), payload.get("endMs"), payload.get("heardRange")
        if (not _integer(start) or not _integer(end) or not 0 <= start < end
                or end * 16 > task["sourceFrames"]):
            raise ValueError("Human location must remain inside complete original PCM frames")
        if (not isinstance(heard, dict) or set(heard) != {"startMs", "endMs", "complete"}
                or not _integer(heard["startMs"]) or not _integer(heard["endMs"]) or heard["complete"] is not True
                or heard != {"startMs": start, "endMs": end, "complete": True}):
            raise ValueError("Listen to the exact complete selected source range before saving")
        method = "human-source-range-selection"
    elif payload.get("kind") == "source-remediation":
        if (not set(payload) <= common | {"decision"} or payload.get("decision") not in DECISIONS
                or not note.strip()):
            raise ValueError("Record the source problem and its explicit decision")
        method = "human-source-remediation-request"
    else:
        raise ValueError("This task cannot accept that action response")
    row = deepcopy(payload)
    row.update(note=note, savedAt=_now(), publicationStatus="held", automaticApproval=False,
               reviewMethod=method)
    return {**row, "responseSha256": digest_json(row)}


class ActionDatabase:
    """A distinct append-only store for action definitions, responses and worker outcomes."""

    def __init__(self, path):
        """Open a distinct action store while rejecting review or publication databases."""
        path = Path(path)
        if not path.is_absolute() or path.name in {"recitation.sqlite", "recitation-working.sqlite", "reviews.sqlite"}:
            raise ValueError("Use a separate absolute action database path")
        self.path = path.resolve()
        if self.path.exists():
            with closing(sqlite3.connect(self.path.as_uri() + "?mode=ro", uri=True)) as db:
                tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if tables - {"action_definition", "action_response", "action_outcome", "sqlite_sequence"}:
                raise ValueError("An action store cannot modify an existing review or publication database")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with (
            closing(sqlite3.connect(self.path)) as db,
            db,
        ):
            db.executescript("""
                CREATE TABLE IF NOT EXISTS action_definition (
                    task_id TEXT PRIMARY KEY, task_sha TEXT UNIQUE NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS action_response (
                    submission_id TEXT PRIMARY KEY, request_sha TEXT NOT NULL, task_id TEXT NOT NULL,
                    body TEXT NOT NULL, saved_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS action_outcome (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT, submission_id TEXT NOT NULL, task_id TEXT NOT NULL,
                    state TEXT NOT NULL, outcome_sha TEXT UNIQUE NOT NULL, body TEXT NOT NULL, recorded_at TEXT NOT NULL);
            """)

    def seed(self, definitions):
        """Append immutable task definitions, checking each allowlisted original exactly once."""
        if not isinstance(definitions, list):
            raise ValueError("Expected action definitions")
        checked = []
        for definition in definitions:
            task = deepcopy(definition)
            if isinstance(task, dict) and "taskSha256" not in task:
                task["taskSha256"] = task_digest(task)
            checked.append(validate_task(task))
        if len({task["taskId"] for task in checked}) != len(checked):
            raise ValueError("Duplicate action identities")
        sources = {}
        for task in checked:
            source = Path(task["sourceAudioPath"]).resolve()
            if source not in sources:
                sources[source] = digest_file(source)
            if sources[source] != task["audioSha256"]:
                raise ValueError("Action original audio changed")
        playbacks = set()
        for task in checked:
            if "sourcePlaybackPath" in task:
                key = (task["sourcePlaybackPath"], task["playbackSha256"],
                       task["sourceFrames"], task["sourcePcmSha256"])
                if key not in playbacks:
                    playback_bytes(task)
                    playbacks.add(key)
        inserted = 0
        with (
            closing(sqlite3.connect(self.path)) as db,
            db,
        ):
            db.execute("BEGIN IMMEDIATE")
            for task in checked:
                previous = db.execute("SELECT body FROM action_definition WHERE task_id=?", (task["taskId"],)).fetchone()
                body = json.dumps(task, ensure_ascii=False)
                if previous:
                    if json.loads(previous[0]) != task:
                        raise ValueError("An immutable action definition was changed")
                    continue
                db.execute("INSERT INTO action_definition VALUES (?,?,?,?)",
                           (task["taskId"], task["taskSha256"], body, _now()))
                inserted += 1
        return inserted

    def task(self, task_id):
        """Return one exact private immutable definition."""
        with closing(sqlite3.connect(self.path)) as db:
            row = db.execute("SELECT body FROM action_definition WHERE task_id=?", (task_id,)).fetchone()
        if not row:
            raise ValueError("Unknown source action")
        return json.loads(row[0])

    def tasks(self, private=False):
        """Private callers receive exact definitions, without mutable hash-breaking fields."""
        if not private:
            return self.public_view()["tasks"]
        with closing(sqlite3.connect(self.path)) as db:
            return [json.loads(row[0]) for row in db.execute(
                "SELECT body FROM action_definition ORDER BY rowid")]

    def save_response(self, payload):
        """Append one authentic input; exact duplicates do not invent a second response."""
        if not isinstance(payload, dict):
            raise ValueError("Expected an action response")
        if (not isinstance(payload.get("submissionId"), str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", payload["submissionId"])
                or not isinstance(payload.get("taskId"), str)
                or not re.fullmatch(IDENTIFIER, payload["taskId"])):
            raise ValueError("Exact action and submission identities are required")
        request_sha = digest_json(payload)
        with (
            closing(sqlite3.connect(self.path)) as db,
            db,
        ):
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT request_sha,body FROM action_response WHERE submission_id=?",
                             (payload.get("submissionId"),)).fetchone()
            if old:
                if old[0] != request_sha:
                    raise ValueError("Submission identity already belongs to another action response")
                return json.loads(old[1])
            found = db.execute("SELECT body FROM action_definition WHERE task_id=?",
                               (payload.get("taskId"),)).fetchone()
            if not found:
                raise ValueError("Unknown source action")
            task = json.loads(found[0])
            if payload.get("kind") == "locate-source-range" and next(
                    row["state"] for row in self.public_view()["tasks"] if row["taskId"] == task["taskId"]) == "resolved":
                raise ValueError("This action already has a validated genuine GOOD chapter")
            row = validate_response(task, payload)
            db.execute("INSERT INTO action_response VALUES (?,?,?,?,?)",
                       (row["submissionId"], request_sha, row["taskId"],
                        json.dumps(row, ensure_ascii=False), row["savedAt"]))
        return row

    def responses(self):
        """Export every actual saved field, preserving edits and repeated genuine submissions."""
        with closing(sqlite3.connect(self.path)) as db:
            return [json.loads(row[0]) for row in db.execute(
                "SELECT body FROM action_response ORDER BY saved_at,rowid")]

    def outcomes(self):
        """Return actual append-only worker events separately from human responses."""
        with closing(sqlite3.connect(self.path)) as db:
            return [json.loads(row[0]) for row in db.execute("SELECT body FROM action_outcome ORDER BY seq")]

    def outcome_for(self, taskId):
        """Return the latest worker event for a task without changing its definition."""
        with closing(sqlite3.connect(self.path)) as db:
            row = db.execute("SELECT body FROM action_outcome WHERE task_id=? ORDER BY seq DESC LIMIT 1",
                             (taskId,)).fetchone()
        return json.loads(row[0]) if row else None

    def _record_event(self, submission_id, task_id, state, details, actor):
        if state not in STATES or not isinstance(details, dict):
            raise ValueError("Invalid action worker outcome")
        task = self.task(task_id)
        if "caseRef" in details:
            _validate_case_ref(details["caseRef"], task["perekId"], task["pasuk"])
        if state == "resolved" and (details.get("genuineGoodValidated") is not True
                or details.get("chapterValidated") is not True or not _sha(details.get("reviewSha256"))
                or not _sha(details.get("chapterValidationSha256"))):
            raise ValueError("Resolution requires genuine GOOD and complete chapter validation")
        event = {"submissionId": submission_id, "taskId": task_id, "state": state,
                 "details": deepcopy(details), "actor": actor}
        sha = digest_json(event)
        with (
            closing(sqlite3.connect(self.path)) as db,
            db,
        ):
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT body FROM action_outcome WHERE outcome_sha=?", (sha,)).fetchone()
            if old:
                return json.loads(old[0])
            event.update(outcomeSha256=sha, recordedAt=_now())
            db.execute("INSERT INTO action_outcome(submission_id,task_id,state,outcome_sha,body,recorded_at) "
                       "VALUES (?,?,?,?,?,?)",
                       (submission_id, task_id, state, sha, json.dumps(event, ensure_ascii=False), event["recordedAt"]))
        return event

    def record_outcome(self, submissionId, state, details):
        """Bind processing outcomes to one genuine saved source-action response."""
        if not isinstance(submissionId, str):
            raise ValueError("Invalid action submission identity")
        with closing(sqlite3.connect(self.path)) as db:
            response = db.execute("SELECT task_id FROM action_response WHERE submission_id=?",
                                  (submissionId,)).fetchone()
        if not response:
            raise ValueError("Worker outcome requires an actual action response")
        return self._record_event(submissionId, response[0], state, details, "response-processor")

    def record_task_state(self, taskId, state, details):
        """Record internal workflow evidence without inventing a human response."""
        return self._record_event("worker-" + taskId, taskId, state, details, "chapter-workflow")

    def public_view(self):
        """Show explicit action states and safe source identities without exposing any local paths."""
        with closing(sqlite3.connect(self.path)) as db:
            tasks = [json.loads(row[0]) for row in db.execute(
                "SELECT body FROM action_definition ORDER BY rowid")]
            responses = [json.loads(row[0]) for row in db.execute(
                "SELECT body FROM action_response ORDER BY saved_at,rowid")]
            outcomes = [json.loads(row[0]) for row in db.execute(
                "SELECT body FROM action_outcome ORDER BY seq")]
        states = {task["taskId"]: ("review" if task["kind"] == "review-cuts" else
                  "needs_source" if task["kind"] == "source-remediation" else "pending") for task in tasks}
        latest = {row["taskId"]: row for row in responses}
        effective = {}
        events = [(row["savedAt"], index, "response", row) for index, row in enumerate(responses)]
        events.extend((row["recordedAt"], index, "outcome", row) for index, row in enumerate(outcomes))
        for _when, _index, kind, row in sorted(events, key=lambda event: (event[0], event[1])):
            task_id = row["taskId"]
            if kind == "response":
                states[task_id] = "context_queued" if row["kind"] == "locate-source-range" else "needs_source"
                effective.pop(task_id, None)
            elif (row.get("actor") != "response-processor" or task_id not in latest
                  or row["submissionId"] == latest[task_id]["submissionId"]):
                states[task_id] = row["state"]
                if "caseRef" in row["details"]:
                    effective[task_id] = row["details"]["caseRef"]
        public = []
        keys = ("taskId", "taskSha256", "kind", "perekId", "pasuk", "label", "audioSha256", "textSha256",
                "sourceFrames", "sourceSampleRate", "canonicalWords", "caseId", "candidateSha256",
                "clipSha256", "issueURL", "playbackSha256", "neighborWords", "chapterConcern")
        for task in tasks:
            row = {key: deepcopy(task[key]) for key in keys if key in task}
            row.update(id=task["taskId"], sourceDurationMs=task["sourceFrames"] // 16,
                       state=states[task["taskId"]])
            ref = effective.get(task["taskId"], task.get("caseRef"))
            if ref is None and task["kind"] == "review-cuts":
                ref = {key: task[key] for key in ("caseId", "candidateSha256", "clipSha256")}
            if ref is not None:
                row["caseRef"] = deepcopy(ref)
                initial = task.get("caseRef")
                if initial is None and task["kind"] == "review-cuts":
                    initial = {key: task[key] for key in ("caseId", "candidateSha256", "clipSha256")}
                if ref != initial:
                    row.pop("chapterConcern", None)
            if "issueUrl" in task:
                row["issueURL"] = task["issueUrl"]
            public.append(row)
        return {"version": 1, "tasks": public}

    def audio(self, task_id):
        """Serve only the immutable allowlisted original whose exact SHA is still current."""
        task = self.task(task_id)
        path = Path(task["sourceAudioPath"])
        before = path.stat()
        raw = path.read_bytes()
        after = path.stat()
        if ((before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns)
                or hashlib.sha256(raw).hexdigest() != task["audioSha256"]):
            raise ValueError("Action original audio changed")
        return playback_bytes(task) if "sourcePlaybackPath" in task else raw
