"""One append-only local review database; immutable source queues remain evidence."""
import argparse
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import hashlib
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import re
import sqlite3
import threading
from urllib.parse import parse_qs, urlsplit

from listening_edits import validate_cut_edit, validate_word_review
from listening_files import read_state_json
from listening_review import (ListeningHandler, digest_file, digest_json,
                              load_queue, read_json, session_token, validate_decision, write_json)


def case_key(case):
    return ":".join((case["id"], case["candidateSha256"], case["clipSha256"]))


def entry_key(row):
    return ":".join((row["caseId"], row["candidateSha256"], row["clipSha256"]))


def stamp(row):
    return datetime.fromisoformat(row["savedAt"].replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()


def preparation_status(path):
    """Return only public counters and stable codes from the local job status file."""
    status = read_state_json(path)
    if not isinstance(status, dict) or not isinstance(status.get("state"), str):
        raise ValueError("Invalid preparation status")
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,79}", status["state"]):
        raise ValueError("Invalid preparation state")
    public = {"state": status["state"]}
    for name in ("targetVerses", "recordings", "remainingToPrepare", "machinePreparedVerses",
                 "visibleVerses", "visibleWordCuts"):
        if name in status:
            value = status[name]
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise ValueError("Invalid preparation count")
            public[name] = value
    for name in ("counts", "holdReasons"):
        if name in status:
            counts = status[name]
            if (not isinstance(counts, dict)
                    or any(not isinstance(key, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,79}", key)
                           or not isinstance(value, int) or isinstance(value, bool) or value < 0
                           for key, value in counts.items())):
                raise ValueError("Invalid preparation count map")
            public[name] = counts
    if "updatedAt" in status:
        value = status["updatedAt"]
        if not isinstance(value, str) or len(value) > 64:
            raise ValueError("Invalid preparation update time")
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        public["updatedAt"] = value
    return public


class ReviewDatabase:
    def __init__(self, path):
        """Bind a separate durable review store without touching alignment data."""
        self.path = Path(path).resolve()
        if self.path.name in {"recitation.sqlite", "recitation-working.sqlite"}:
            raise ValueError("Use a separate listening database, never publication or worker data")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.sync_lock = threading.Lock()
        self.on_saved = None
        with self._transaction() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS batch (
                    seq INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL,
                    file_sha TEXT NOT NULL, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS candidate (
                    key TEXT PRIMARY KEY, case_id TEXT NOT NULL, batch_seq INTEGER NOT NULL,
                    body TEXT NOT NULL, queue_sha TEXT NOT NULL, visible INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS current_candidate (case_id TEXT PRIMARY KEY, key TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS history (
                    path TEXT PRIMARY KEY, batch_seq INTEGER NOT NULL, prefix TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS entry (
                    digest TEXT PRIMARY KEY, body TEXT NOT NULL, saved_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS cut_edit (
                    proposal_sha TEXT PRIMARY KEY, body TEXT NOT NULL, saved_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS word_review (
                    submission_id TEXT PRIMARY KEY, request_sha TEXT NOT NULL,
                    body TEXT NOT NULL, saved_at TEXT NOT NULL);
            """)

    @contextmanager
    def _transaction(self):
        """Commit one operation or roll it back, then always close its connection."""
        with closing(sqlite3.connect(self.path)) as db:
            with db:
                yield db

    def _insert_entries(self, db, entries):
        for row in entries:
            db.execute("INSERT OR IGNORE INTO entry VALUES (?,?,?)",
                       (digest_json(row), json.dumps(row, ensure_ascii=False), stamp(row)))

    def _entries(self, db):
        return [json.loads(row[0]) for row in db.execute(
            "SELECT body FROM entry ORDER BY saved_at, digest")]

    def append(self, queue_path, reviews_path=None, *, only_unseen=False):
        """Validate a prepared batch, then atomically append without editing older queues."""
        queue_path = Path(queue_path).resolve()
        queue = load_queue(queue_path)
        from listening_accept import verify_diagnostic
        for case in queue["cases"]:
            verify_diagnostic(case)
        raw = queue_path.read_bytes()
        if json.loads(raw) != queue:
            raise ValueError("Queue changed during validation")
        file_sha = hashlib.sha256(raw).hexdigest()
        entries = read_json(Path(reviews_path))["entries"] if reviews_path else []
        with self._transaction() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT seq, file_sha FROM batch WHERE path=?", (str(queue_path),)).fetchone()
            if old and old[1] != file_sha:
                raise ValueError("An immutable batch was changed")
            if old:
                return old[0]
            if only_unseen:
                for case in queue["cases"]:
                    if db.execute("SELECT 1 FROM candidate WHERE case_id=? LIMIT 1",
                                  (case["id"],)).fetchone():
                        raise ValueError("Automatic refill cannot replace a previously offered verse: " + case["id"])
            self._insert_entries(db, entries)
            decisions = {entry_key(row): row for row in self._entries(db)}
            cursor = db.execute("INSERT INTO batch(path,file_sha,body) VALUES (?,?,?)",
                                (str(queue_path), file_sha, raw.decode("utf-8")))
            seq = cursor.lastrowid
            for case in queue["cases"]:
                key = case_key(case)
                old_case = db.execute("SELECT body FROM candidate WHERE key=?", (key,)).fetchone()
                if old_case:
                    previous = json.loads(old_case[0])
                    # Older pages copied identical clips/proofs and changed only display hints.
                    # load_queue already revalidates both files against the same bound hashes.
                    display_fields = {"clipPath", "listeningReusePath", "correctionNote",
                                      "changedSegments", "reviewKind"}
                    if {k: v for k, v in previous.items() if k not in display_fields} != {
                            k: v for k, v in case.items() if k not in display_fields}:
                        raise ValueError("An existing candidate was modified without new evidence")
                decision = decisions.get(key)
                visible = not decision or decision["verdict"] == "skip"
                db.execute("INSERT OR IGNORE INTO candidate VALUES (?,?,?,?,?,?)",
                           (key, case["id"], seq, json.dumps(case, ensure_ascii=False),
                            queue["queueSha256"], int(visible)))
                db.execute("INSERT OR REPLACE INTO current_candidate VALUES (?,?)", (case["id"], key))
                # A byte-identical case retains its original evidence binding.
            if reviews_path:
                db.execute("INSERT INTO history VALUES (?,?,?)",
                           (str(Path(reviews_path).resolve()), seq,
                            json.dumps([digest_json(row) for row in entries])))
        return seq

    def sync_histories(self):
        """Import real answers from older still-open pages, preserving every actual row."""
        with self.sync_lock, self._transaction() as db:
            for path, seq, prefix in db.execute("SELECT path,batch_seq,prefix FROM history").fetchall():
                batch = db.execute("SELECT path,file_sha FROM batch WHERE seq=?", (seq,)).fetchone()
                if digest_file(Path(batch[0])) != batch[1]:
                    raise ValueError("An immutable source queue changed")
                rows = read_json(Path(path))["entries"]
                digests = [digest_json(row) for row in rows]
                old = json.loads(prefix)
                if digests[:len(old)] != old:
                    raise ValueError("Saved history was rewritten; keep the last valid database")
                self._insert_entries(db, rows)
                db.execute("UPDATE history SET prefix=? WHERE path=?", (json.dumps(digests), path))

    def seed(self, sources):
        """One-time migration: preserve all answers and offer only outstanding versions."""
        with closing(sqlite3.connect(self.path)) as db:
            if db.execute("SELECT count(*) FROM batch").fetchone()[0]:
                raise ValueError("Seed only an empty review database")
        for source in sources:
            path = Path(source["queue"])
            if digest_file(path) != source["queueSha256"]:
                raise ValueError("Source queue differs from its fixed binding")
            self.append(path, Path(source["reviews"]))
        with self._transaction() as db:
            latest = {entry_key(row): row for row in self._entries(db)}
            for key, row in latest.items():
                if row["verdict"] != "skip":
                    db.execute("UPDATE candidate SET visible=0 WHERE key=?", (key,))

    def case(self, identifier, candidate, clip=None):
        if (not isinstance(identifier, str) or not isinstance(candidate, str)
                or (clip is not None and not isinstance(clip, str))):
            raise ValueError("Exact listening candidate identities must be text")
        with closing(sqlite3.connect(self.path)) as db:
            rows = [json.loads(row[0]) for row in db.execute(
                "SELECT body FROM candidate WHERE case_id=?", (identifier,))]
        matches = [c for c in rows if c["candidateSha256"] == candidate
                   and (clip is None or c["clipSha256"] == clip)]
        if len(matches) != 1:
            raise ValueError("Unknown or ambiguous exact listening candidate")
        return matches[0]

    def save(self, case, payload):
        if payload.get("timingEdits"):
            raise ValueError("Edited word timings require a current whole-verse timing review; the draft was not approved")
        # Re-read the immutable stored version, not a browser-supplied candidate body.
        exact = self.case(case["id"], payload.get("candidateSha256"), payload.get("clipSha256"))
        row = validate_decision(exact, payload)
        with self._transaction() as db:
            row["queueSha256"] = db.execute("SELECT queue_sha FROM candidate WHERE key=?",
                                            (case_key(exact),)).fetchone()[0]
            self._insert_entries(db, [row])
        if self.on_saved:
            self.on_saved()
        return row

    def save_cut_edits(self, payload):
        """Append a held proposal for the current immutable candidate, never a verdict."""
        with self._transaction() as db:
            db.execute("BEGIN IMMEDIATE")
            stored = db.execute("SELECT c.key,c.body,c.queue_sha FROM current_candidate current "
                                "JOIN candidate c ON c.key=current.key WHERE current.case_id=?",
                                (payload.get("caseId"),)).fetchone()
            if stored is None:
                raise ValueError("Unknown current listening candidate")
            case = json.loads(stored[1])
            if stored[0] != ":".join((str(payload.get("caseId")),
                                      str(payload.get("candidateSha256")), str(payload.get("clipSha256")))):
                raise ValueError("This listening candidate was replaced; open the current version before editing")
            row = validate_cut_edit(case, payload)
            row["queueSha256"] = stored[2]
            proposal_sha = digest_json(row)
            previous = db.execute("SELECT body FROM cut_edit WHERE proposal_sha=?", (proposal_sha,)).fetchone()
            if previous:
                return json.loads(previous[0])
            row.update(proposalSha256=proposal_sha, savedAt=datetime.now(timezone.utc).isoformat())
            db.execute("INSERT INTO cut_edit VALUES (?,?,?)",
                       (proposal_sha, json.dumps(row, ensure_ascii=False), row["savedAt"]))
        return row

    def _cut_edits(self, db):
        return [json.loads(row[0]) for row in db.execute(
            "SELECT body FROM cut_edit ORDER BY saved_at, proposal_sha")]

    def all_cut_edits(self):
        with closing(sqlite3.connect(self.path)) as db:
            return self._cut_edits(db)

    def save_word_review(self, payload):
        """Atomically save one whole-verse verdict and finish its exact work item."""
        # GOOD/SKIP cannot carry an obsolete problem note into the new real answer.
        request = dict(payload)
        if not isinstance(request.get("submissionId"), str):
            raise ValueError("A unique review submission identity is required")
        if any(not isinstance(request.get(key), str) for key in
               ("caseId", "candidateSha256", "clipSha256")):
            raise ValueError("Exact listening candidate identities must be text")
        if request.get("verdict") in ("good", "skip"):
            request["note"] = ""
        request_sha = digest_json(request)
        with self._transaction() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT request_sha,body FROM word_review WHERE submission_id=?",
                                  (request.get("submissionId"),)).fetchone()
            if previous:
                if previous[0] != request_sha:
                    raise ValueError("This submission identity already belongs to a different review")
                return json.loads(previous[1])
            stored = db.execute("SELECT c.key,c.body,c.queue_sha FROM current_candidate current "
                                "JOIN candidate c ON c.key=current.key WHERE current.case_id=?",
                                (request.get("caseId"),)).fetchone()
            if stored is None:
                raise ValueError("Unknown current listening candidate")
            case = json.loads(stored[1])
            if stored[0] != ":".join((str(request.get("caseId")),
                                      str(request.get("candidateSha256")), str(request.get("clipSha256")))):
                raise ValueError("This listening candidate was replaced; open the current version before reviewing")
            row = validate_word_review(case, request)
            row.update(queueSha256=stored[2], savedAt=datetime.now(timezone.utc).isoformat())
            db.execute("INSERT INTO word_review VALUES (?,?,?,?)",
                       (row["submissionId"], request_sha, json.dumps(row, ensure_ascii=False), row["savedAt"]))
            db.execute("UPDATE candidate SET visible=0 WHERE key=?", (stored[0],))
        if self.on_saved:
            self.on_saved()
        return row

    def _word_reviews(self, db):
        return [json.loads(row[0]) for row in db.execute(
            "SELECT body FROM word_review ORDER BY saved_at, rowid")]

    def all_word_reviews(self):
        with closing(sqlite3.connect(self.path)) as db:
            return self._word_reviews(db)

    def all_entries(self):
        with closing(sqlite3.connect(self.path)) as db:
            return self._entries(db)

    def export_feedback(self):
        """Read every actual feedback stream in one short, consistent transaction."""
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("BEGIN")
            return {"entries": self._entries(db), "timingEdits": self._cut_edits(db),
                    "wordReviews": self._word_reviews(db)}

    def preparation_workload(self):
        """Expose only the inventory needed by the local never-offered refill job."""
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("BEGIN")
            offered = [row[0] for row in db.execute("SELECT DISTINCT case_id FROM candidate ORDER BY case_id")]
            visible = db.execute("SELECT c.case_id,c.key,c.body FROM candidate c "
                                 "JOIN current_candidate current ON current.key=c.key "
                                 "WHERE c.visible=1 ORDER BY c.batch_seq,c.rowid").fetchall()
            return {"offeredCaseIds": offered, "visibleCaseIds": [row[0] for row in visible],
                    "visibleWordCuts": sum(len(json.loads(row[2])["words"]) for row in visible),
                    "revision": digest_json([offered, [row[1] for row in visible]])}

    def snapshot(self):
        with closing(sqlite3.connect(self.path)) as db:
            return {entry_key(row): row for row in self._entries(db)}

    def view(self):
        with closing(sqlite3.connect(self.path)) as db:
            rows = db.execute("SELECT key,body,visible,batch_seq FROM candidate ORDER BY batch_seq,rowid").fetchall()
            current = dict(db.execute("SELECT case_id,key FROM current_candidate"))
            latest = {}
            for key, body, visible, seq in rows:
                case = json.loads(body)
                if current[case["id"]] == key:
                    latest[case["id"]] = (key, case, visible)
            cases = [case for key, case, visible in latest.values() if visible]
            retired = [json.loads(body) for key, body, visible, seq in rows
                       if visible and latest[json.loads(body)["id"]][0] != key]
            entries = self._entries(db)
            word_reviews = self._word_reviews(db)
            revision = digest_json([current, [(key, seq, visible) for key, body, visible, seq in rows],
                                    [digest_json(row) for row in entries],
                                    [digest_json(row) for row in word_reviews]])
        return {"cases": cases, "retiredCases": retired,
                "decisions": {entry_key(row): row for row in entries},
                "wordReviewDecisions": {entry_key(row): row for row in word_reviews}, "revision": revision}

    def export(self, output):
        """Freeze a consistent snapshot for the unchanged guarded publication importer."""
        self.sync_histories()
        output = Path(output)
        output.mkdir(parents=True, exist_ok=False)
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("BEGIN")
            batches = db.execute("SELECT seq,path,file_sha,body FROM batch ORDER BY seq").fetchall()
            entries = self._entries(db)
            word_reviews = self._word_reviews(db)
        if not batches:
            raise ValueError("No review batches")
        archives = []
        for seq, path, expected, body in batches:
            if digest_file(Path(path)) != expected:
                raise ValueError("An immutable source queue changed")
            folder = output / f"batch-{seq}"
            folder.mkdir()
            target = folder / "queue.json"
            target.write_bytes(body.encode("utf-8"))
            if digest_file(target) != expected:
                raise ValueError("Snapshot changed original queue bytes")
            archives.append({"path": str(target.resolve()), "sha256": expected,
                             "caseCount": len(json.loads(body)["cases"])})
        queue = {"version": 1, "publicationStatus": "held",
                 "canonicalPath": json.loads(batches[-1][3])["canonicalPath"],
                 "cases": [], "queueSha256": digest_json([]), "archivedQueues": archives}
        write_json(output / "queue.json", queue)
        write_json(output / "reviews.json", {"version": 1, "entries": entries, "wordReviews": word_reviews})
        return output / "queue.json", output / "reviews.json", Path(queue["canonicalPath"])


class QueueHandler(ListeningHandler):
    def do_GET(self):
        if not self.valid_host():
            return self.json_response(403, {"error": "Loopback host required"})
        parts = urlsplit(self.path)
        if self.path == "/api/preparation-status":
            path = self.server.preparation_status
            if path is None:
                return self.json_response(404, {"error": "Preparation status not configured"})
            try:
                return self.json_response(200, preparation_status(path))
            except (ValueError, TypeError, OSError):
                return self.json_response(409, {"error": "Preparation status unavailable"})
        if self.path == "/api/preparation-workload":
            return self.json_response(200, self.server.review_store.preparation_workload())
        if self.path == "/api/queue":
            try:
                self.server.review_store.sync_histories()
                view = self.server.review_store.view()
                for group in ("cases", "retiredCases"):
                    view[group] = [{k: v for k, v in c.items() if not k.endswith("Path")}
                                   for c in view[group]]
                return self.json_response(200, {**view, "token": self.server.token, "persistentQueue": True})
            except (ValueError, KeyError, OSError, sqlite3.Error) as error:
                return self.json_response(409, {"error": str(error)})
        if parts.path.startswith("/clips/"):
            try:
                values = parse_qs(parts.query)
                case = self.server.review_store.case(parts.path.removeprefix("/clips/"),
                        values.get("candidate", [""])[0], values.get("clip", [None])[0])
                raw = Path(case["clipPath"]).read_bytes()
                if hashlib.sha256(raw).hexdigest() != case["clipSha256"]:
                    raise ValueError("Listening audio changed")
                return self.send(200, raw, "audio/wav")
            except (ValueError, OSError):
                return self.json_response(409, {"error": "Exact listening audio unavailable"})
        if self.path == "/api/cut-edits":
            return self.json_response(200, {"entries": self.server.review_store.all_cut_edits()})
        if self.path == "/api/word-reviews":
            return self.json_response(200, {"entries": self.server.review_store.all_word_reviews()})
        if self.path == "/api/export":
            return self.json_response(200, {"version": 1,
                **self.server.review_store.export_feedback(),
                "publicationStatus": "held"})
        if self.path == "/api/archive":
            entries = sorted([*self.server.review_store.all_entries(),
                              *self.server.review_store.all_word_reviews()], key=stamp)
            return self.json_response(200, [{"caseCount": len(entries),
                                            "cases": [{"id": row["caseId"], "label": row["caseId"],
                                                       "decision": row}
                                                      for row in entries]}])
        return super().do_GET()

    def do_POST(self):
        if self.path not in ("/api/cut-edits", "/api/word-reviews") or not self.review_session_valid():
            return super().do_POST()
        try:
            _case, payload = self.review_payload()
            row = (self.server.review_store.save_word_review(payload) if self.path == "/api/word-reviews"
                   else self.server.review_store.save_cut_edits(payload))
            return self.json_response(200, row)
        except (ValueError, KeyError, TypeError) as error:
            return self.json_response(400, {"error": str(error)})
        except (OSError, sqlite3.Error):
            return self.json_response(500, {"error": "Could not save review; please retry"})

    def review_payload(self):
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 < size <= 16384 or self.headers.get("Content-Type") != "application/json":
            raise ValueError("Invalid review request")
        payload = json.loads(self.rfile.read(size))
        if not isinstance(payload, dict):
            raise ValueError("Expected a review object")
        return self.server.review_store.case(payload.get("caseId"), payload.get("candidateSha256"),
                                             payload.get("clipSha256")), payload


def make_queue_server(database, port, token_path=None, *, preparation_status=None):
    if preparation_status is not None:
        preparation_status = Path(preparation_status)
        if not preparation_status.is_absolute():
            raise ValueError("Preparation status file must use an absolute path")
        preparation_status = preparation_status.resolve()
    server = ThreadingHTTPServer(("127.0.0.1", port), QueueHandler)
    server.review_store = database
    server.origin = f"http://127.0.0.1:{server.server_port}"
    server.token = session_token(token_path, "accumulated-listening-database-v1")
    server.template = Path(__file__).with_name("listening_review.html").read_bytes()
    server.recovery = None
    server.preparation_status = preparation_status
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--store", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    append = commands.add_parser("append")
    append.add_argument("--queue", type=Path, required=True)
    append.add_argument("--reviews", type=Path)
    append.add_argument("--only-unseen", action="store_true",
                        help="Reject the entire batch if any verse was previously offered")
    serve = commands.add_parser("serve")
    serve.add_argument("--port", type=int, default=8792)
    serve.add_argument("--session-token-file", type=Path)
    serve.add_argument("--preparation-status-file", type=Path)
    snapshot = commands.add_parser("snapshot")
    snapshot.add_argument("--output", type=Path, required=True)
    snapshot.add_argument("--database", type=Path)
    args = parser.parse_args()
    store = ReviewDatabase(args.store)
    if args.command == "append":
        print("Appended batch", store.append(args.queue, args.reviews, only_unseen=args.only_unseen), flush=True)
    elif args.command == "snapshot":
        # Never use the live collection checkpoint or authoritative publication DB as a preview.
        if args.database and args.database.name in {"recitation.sqlite", "recitation-working.sqlite"}:
            parser.error("Use a separate CURRENT durable preview database")
        queue, reviews, text = store.export(args.output)
        summary = None
        if args.database:
            from listening_accept import stage_reviews
            summary = stage_reviews(queue, reviews, text, args.output / "accepted", args.database)
            print(summary, flush=True)
        write_json(args.output / "actual-history-proof.json",
                   {"distinctEntries": len(read_json(reviews)["entries"]),
                    "allActualHistoriesPreserved": True, "noReviewInvented": True,
                    "summary": summary})
    else:
        server = make_queue_server(store, args.port, args.session_token_file,
                                   preparation_status=args.preparation_status_file)
        print(server.origin, flush=True)
        try:
            server.serve_forever()
        finally:
            server.server_close()


if __name__ == "__main__":
    main()
