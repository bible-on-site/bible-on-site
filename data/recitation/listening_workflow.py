"""Connect genuine concern actions to local preparation and complete chapter checks."""
import argparse
from collections import defaultdict
from contextlib import closing
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import http.client
import json
from pathlib import Path
import re
import shutil
import sqlite3
import time
from urllib.parse import urlsplit

from listening_accept import current_review_decisions, stage_reviews
from listening_actions import ActionDatabase
from listening_audio import original_audio_errors
from listening_files import read_state_json, write_state_json
from listening_prepare import WorkerLock
from listening_queue import ReviewDatabase
from listening_review import candidate_digest, chapter_labels, digest_file, digest_json, hebrew_number, read_json

POLICY = "complete-concern-workflow-v1"


def now():
    """Use one explicit UTC representation for machine events, never human saves."""
    return datetime.now(timezone.utc).isoformat()


class ConcernWorkflow:
    """Own an isolated result database; never modify original sources or publication."""

    def __init__(self, config, *, fetch=None, seeder=None, context_builder=None,
                 context_writer=None, importer=stage_reviews):
        """Bind fixed original inputs, a loopback app and isolated durable result state."""
        self.config = deepcopy(config)
        if config.get("version") != 1:
            raise ValueError("Unknown concern workflow configuration")
        names = ("stateDirectory", "actionStore", "publicationDatabase", "reviewStore",
                 "canonicalPath", "planPath", "jobRoot", "recordings", "batchRoot", "queueSnapshot")
        self.paths = {name: Path(config[name]) for name in names}
        if any(not path.is_absolute() for path in self.paths.values()):
            raise ValueError("Every concern workflow path must be absolute")
        self.paths = {name: path.resolve() for name, path in self.paths.items()}
        if (self.paths["publicationDatabase"].name == "recitation-working.sqlite"
                or len({self.paths[name] for name in ("actionStore", "publicationDatabase", "reviewStore")}) != 3):
            raise ValueError("Concern evidence cannot use a live checkpoint or another database")
        parsed = urlsplit(config["reviewUrl"])
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
                or parsed.username or parsed.password or parsed.path not in ("", "/")
                or parsed.query or parsed.fragment or parsed.port == 0):
            raise ValueError("Use the existing loopback review app")
        self.port = parsed.port or 80
        interval = config.get("pollSeconds", 5)
        if not isinstance(interval, int) or isinstance(interval, bool) or interval < 1:
            raise ValueError("The local workflow interval must be a positive integer")
        self.fetch = fetch or self._fetch
        self.seeder = seeder
        self.context_builder, self.context_writer, self.importer = context_builder, context_writer, importer
        self.state = self.paths["stateDirectory"]
        if self.state.is_relative_to(self.paths["jobRoot"]):
            raise ValueError("Never write concern state into completed diagnostic evidence")
        self.state.mkdir(parents=True, exist_ok=True)
        self.result = self.state / "results" / "recitation.sqlite"
        if self.result in self.paths.values():
            raise ValueError("Use a separate current durable result mirror")
        self.result.parent.mkdir(exist_ok=True)
        self.ledger_path = self.state / "workflow-ledger.json"
        self.status_path = self.paths["actionStore"].with_name("workflow-status.json")
        self.fingerprint = digest_json({"policy": POLICY, "plan": config["planSha256"],
            "canonical": digest_file(self.paths["canonicalPath"]),
            "publication": config["publicationSha256"]})
        if digest_file(self.paths["planPath"]) != config["planSha256"]:
            raise ValueError("The selective repair plan changed")
        self.ledger = read_state_json(self.ledger_path) if self.ledger_path.exists() else {
            "version": 1, "fingerprint": self.fingerprint, "packets": [], "seeded": False,
            "feedbackSha256": None, "validation": None, "resultSha256": config["publicationSha256"],
            "sourceHolds": {}, "feedbackAttemptSha256": None}
        if self.ledger.get("fingerprint") != self.fingerprint:
            raise ValueError("Use distinct workflow state for changed source inputs")
        if not self.result.exists():
            source = self.paths["publicationDatabase"]
            if digest_file(source) != config["publicationSha256"]:
                raise ValueError("The CURRENT durable baseline changed")
            shutil.copy2(source, self.result)
            if digest_file(self.result) != config["publicationSha256"] or digest_file(source) != config["publicationSha256"]:
                raise ValueError("The current durable mirror is not byte-exact")
        if digest_file(self.result) != self.ledger.get("resultSha256", config["publicationSha256"]):
            raise ValueError("The local result mirror has no matching durable provenance")
        self.chapter_labels = chapter_labels(self.paths["canonicalPath"])
        self.actions = ActionDatabase(self.paths["actionStore"])
        self.status = {"state": "starting", "policy": POLICY, "publicationStatus": "local-validated-results",
                       "automaticApprovals": 0, "originalSourceWrites": 0}

    def _fetch(self, suffix):
        """Read only the two fixed local JSON endpoints, without redirects or URL schemes."""
        if suffix not in ("/api/export", "/api/preparation-workload"):
            raise ValueError("Unknown local workflow endpoint")
        with closing(http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)) as connection:
            connection.request("GET", suffix)
            with closing(connection.getresponse()) as response:
                if response.status != 200:
                    raise OSError(f"Local review endpoint returned HTTP {response.status}")
                return json.load(response)

    def _ready(self):
        with closing(sqlite3.connect(self.result.as_uri() + "?mode=ro", uri=True)) as database:
            rows = database.execute("SELECT perek_id,alignment_status FROM recitation_track").fetchall()
        return {pid for pid, _state in rows}, {pid for pid, state in rows if state == "ready"}

    def _save(self, **values):
        self.status.update(values, updatedAt=now())
        if not self.ledger_path.exists() or read_state_json(self.ledger_path) != self.ledger:
            write_state_json(self.ledger_path, self.ledger)
        write_state_json(self.status_path, self.status)

    def _task_state(self, task_id, state, details):
        """Do not turn idle polling into repeated machine events or feedback."""
        previous = self.actions.outcome_for(task_id)
        if previous is None or previous.get("state") != state or previous.get("details") != details:
            self.actions.record_task_state(task_id, state, details)

    def _packet_sources(self):
        """Resolve declared immutable JSON packets without reading a live review database."""
        packets, visiting = {}, set()

        def visit(path, expected=None):
            path = Path(path).resolve()
            raw = path.read_bytes()
            actual = hashlib.sha256(raw).hexdigest()
            if expected is not None and actual != expected:
                raise ValueError("An immutable review packet changed")
            if str(path) in visiting:
                raise ValueError("Cyclic immutable review evidence")
            if str(path) in packets:
                return
            visiting.add(str(path))
            packet = json.loads(raw)
            if (packet.get("version") != 1 or packet.get("publicationStatus") != "held"
                    or digest_json(packet.get("cases")) != packet.get("queueSha256")):
                raise ValueError("Invalid immutable review packet")
            for archive in packet.get("archivedQueues", []):
                visit(archive["path"], archive["sha256"])
            for case in packet["cases"]:
                if candidate_digest(case) != case["candidateSha256"]:
                    raise ValueError("A declared listening candidate changed")
            packets[str(path)] = {"path": str(path), "sha256": actual, "caseCount": len(packet["cases"])}
            visiting.remove(str(path))

        visit(self.paths["queueSnapshot"])
        prepared = self.config.get("preparedLedger")
        if prepared:
            for row in read_state_json(Path(prepared))["cases"].values():
                if row.get("offeredQueue"):
                    visit(row["offeredQueue"], row["offeredQueueSha256"])
        for packet in self.ledger["packets"]:
            visit(packet["path"], packet["sha256"])
        return list(packets.values())

    def _cases(self):
        cases = {}
        for packet in self._packet_sources():
            raw = Path(packet["path"]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != packet["sha256"]:
                raise ValueError("A declared listening packet changed while reading")
            for case in json.loads(raw)["cases"]:
                cases[case["id"]] = case
        return cases

    def seed(self):
        """Make every pending concern either real cut review, location or source remediation."""
        if self.ledger["seeded"]:
            return
        if self.seeder is None:
            from listening_targets import prepare_concerns
            self.seeder = prepare_concerns
        recorded, ready = self._ready()
        workload = self.fetch("/api/preparation-workload")
        config = {**self.config, "pendingIds": sorted(recorded - ready)}
        self._save(state="preparing_actions", totalRecordings=len(recorded), readyRecordings=len(ready),
                   pendingRecordings=len(recorded - ready))
        prepared = self.seeder(config, ready, set(workload["offeredCaseIds"]), self._cases(),
                               progress=lambda values: self._save(**values))
        self.actions.seed(prepared["tasks"])
        store = ReviewDatabase(self.paths["reviewStore"])
        for packet in prepared["queues"]:
            path = Path(packet["path"] if isinstance(packet, dict) else packet)
            expected = packet["sha256"] if isinstance(packet, dict) else digest_file(path)
            if digest_file(path) != expected:
                raise ValueError("A newly prepared source-bound packet changed")
            store.append(path, only_unseen=True)
            descriptor = {"path": str(path.resolve()), "sha256": expected, "caseCount": len(read_json(path)["cases"])}
            if descriptor not in self.ledger["packets"]:
                self.ledger["packets"].append(descriptor)
                self._save()
        self.ledger["seeded"] = True
        self._save(state="waiting_for_actions")

    def _good_ref(self, task):
        """Read actual current approvals again before replacing a listening candidate."""
        cases = self._cases()
        current = cases.get(f"{task['perekId']}-{task['pasuk']}")
        if current is None:
            return None
        feedback = self.fetch("/api/export")
        path = self.state / "actual-before-context-append.json"
        write_state_json(path, feedback)
        decision = current_review_decisions({"cases": list(cases.values())}, path).get(current["id"])
        if decision and decision.get("verdict") == "good":
            ref = {"caseId": current["id"], "candidateSha256": current["candidateSha256"],
                   "clipSha256": current["clipSha256"]}
            if (ref == task.get("caseRef") and digest_json(decision)
                    == task.get("chapterConcern", {}).get("previousReviewSha256")):
                return None
            return ref
        return None

    def _process_contexts(self):
        """Only an actual saved source selection may trigger new local CUDA work."""
        latest = {row["taskId"]: row for row in self.actions.responses()}
        for task_id, response in latest.items():
            if response["kind"] != "locate-source-range":
                continue
            outcomes = [row for row in self.actions.outcomes() if row.get("submissionId") == response["submissionId"]]
            if outcomes and outcomes[-1]["state"] != "preparing":
                continue
            if {row["taskId"]: row for row in self.actions.responses()}.get(task_id, {}).get("responseSha256") != response["responseSha256"]:
                self.actions.record_outcome(response["submissionId"], "pending", {"reasonCode": "superseded_source_selection"})
                continue
            task = self.actions.task(task_id)
            self.actions.record_outcome(response["submissionId"], "preparing", {"reasonCode": "local_source_alignment"})
            self._save(state="preparing_selected_context", currentPerekId=task["perekId"])
            try:
                approved = self._good_ref(task)
                if approved is not None:
                    self.actions.record_outcome(response["submissionId"], "review", {
                        "caseRef": approved, "reasonCode": "existing_genuine_good_preserved"})
                    continue
                if self.context_builder is None:
                    from listening_context import build_context_study, write_context_queue
                    self.context_builder, self.context_writer = build_context_study, write_context_queue
                folder = self.paths["batchRoot"] / ("human-context-" + response["responseSha256"])
                path = folder / "queue.json"
                if not path.exists():
                    with original_audio_errors("Selected original audio preparation failed"):
                        study = self.context_builder(task, response)
                        path = Path(self.context_writer(study, folder, task["label"]))
                if {row["taskId"]: row for row in self.actions.responses()}.get(task_id, {}).get("responseSha256") != response["responseSha256"]:
                    self.actions.record_outcome(response["submissionId"], "pending", {"reasonCode": "superseded_source_selection"})
                    continue
                approved = self._good_ref(task)
                if approved is not None:
                    self.actions.record_outcome(response["submissionId"], "review", {
                        "caseRef": approved, "reasonCode": "existing_genuine_good_preserved"})
                    continue
                previous_good = task.get("chapterConcern", {}).get("previousReviewSha256")
                allowed = {task["caseRef"]["caseId"]: previous_good} if previous_good else None
                ReviewDatabase(self.paths["reviewStore"]).append(path, only_unapproved=True,
                                                               allowed_previous_good=allowed)
                descriptor = {"path": str(path.resolve()), "sha256": digest_file(path),
                              "caseCount": len(read_json(path)["cases"])}
                if descriptor not in self.ledger["packets"]:
                    self.ledger["packets"].append(descriptor)
                case = read_json(path)["cases"][0]
                self.actions.record_outcome(response["submissionId"], "review", {"caseRef": {
                    "caseId": case["id"], "candidateSha256": case["candidateSha256"], "clipSha256": case["clipSha256"]}})
            except (ValueError, KeyError, TypeError, OSError, RuntimeError) as error:
                approved = self._good_ref(task)
                if approved is not None:
                    self.actions.record_outcome(response["submissionId"], "review", {
                        "caseRef": approved, "reasonCode": "existing_genuine_good_preserved"})
                    continue
                # The private error is evidence; the UI gets a safe actionable reason code.
                write_state_json(self.state / ("context-failure-" + response["submissionId"] + ".json"),
                                 {"taskId": task_id, "error": str(error), "recordedAt": now()})
                self.actions.record_outcome(response["submissionId"], "pending", {"reasonCode": "revise_source_selection"})
            self._save(state="waiting_for_actions")

    def _source_holds(self):
        """An actual recording-problem report suspends local readiness, never fabricates PROBLEM."""
        latest = {row["taskId"]: row for row in self.actions.responses()}
        holds = self.ledger.setdefault("sourceHolds", {})
        changed = False
        for task_id, row in latest.items():
            if row["kind"] != "source-remediation" or holds.get(task_id) == row["responseSha256"]:
                continue
            task = self.actions.task(task_id)
            with closing(sqlite3.connect(self.result)) as database:
                with database:
                    found = database.execute("SELECT alignment_status FROM recitation_track WHERE perek_id=?",
                                             (task["perekId"],)).fetchone()
                    if found is None:
                        raise ValueError("Source action refers to an unrecorded chapter")
                    if found[0] == "ready":
                        database.execute("UPDATE recitation_track SET alignment_status='needs_review' WHERE perek_id=?",
                                         (task["perekId"],))
                        changed = True
            holds[task_id] = row["responseSha256"]
        if changed:
            self.ledger["resultSha256"] = digest_file(self.result)
        if latest:
            self._save()

    def _evidence(self, feedback):
        """Close exact API fields and original packets before invoking the existing importer."""
        folder = self.state / "evidence" / ("feedback-" + digest_json(feedback))
        folder.mkdir(parents=True, exist_ok=True)
        packets = self._packet_sources()
        archives = []
        for index, packet in enumerate(packets):
            raw = Path(packet["path"]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != packet["sha256"]:
                raise ValueError("Immutable queue changed during closed evidence collection")
            target = folder / f"packet-{index}.json"
            if target.exists() and target.read_bytes() != raw:
                raise ValueError("Never overwrite a different closed queue snapshot")
            target.write_bytes(raw)
            archives.append({"path": str(target.resolve()), "sha256": packet["sha256"], "caseCount": packet["caseCount"]})
        queue = {"version": 1, "publicationStatus": "held", "canonicalPath": str(self.paths["canonicalPath"]),
                 "cases": [], "queueSha256": digest_json([]), "archivedQueues": archives}
        write_state_json(folder / "queue.json", queue)
        write_state_json(folder / "reviews.json", feedback)
        return folder

    @staticmethod
    def _validation_focus(manifest, pid, held, cases, decisions):
        """Locate actual overlaps after applying only the saved genuine GOOD coordinates."""
        rows = {(row["pasuk"], row["segment"]): deepcopy(row) for row in manifest["words"]}
        approved = [case for case in cases.values() if case["perekId"] == pid
                    and decisions.get(case["id"], {}).get("verdict") == "good"]
        for case in approved:
            for row in decisions[case["id"]].get("candidateWords", case["words"]):
                rows[(row["pasuk"], row["segment"])] = row
        focus = defaultdict(set)
        ordered = [rows[(row["pasuk"], row["segment"])] for row in manifest["words"]]
        for left, right in zip(ordered, ordered[1:]):
            if (isinstance(left.get("endMs"), int) and isinstance(right.get("startMs"), int)
                    and left["endMs"] > right["startMs"]):
                focus[left["pasuk"]].add(left["segment"])
                focus[right["pasuk"]].add(right["segment"])
        reason = "cross_verse_overlap" if focus else "chapter_validation_failure"
        unreviewed = re.search(r"unreviewed pasuk ([0-9]+)", held["reason"])
        if unreviewed:
            focus[int(unreviewed[1])] = set()
        if not focus:
            case = approved[0]
            focus[case["pasuk"]].update(row["segment"] for row in case["words"])
        return focus, reason

    @staticmethod
    def _followup_definition(template, held, verse, segments, words, validation_sha,
                             case, decision, reason):
        """Bind each new chapter concern to its full failed check and exact earlier review."""
        task = deepcopy(template)
        for key in ("taskSha256", "caseRef", "chapterConcern", "issueUrl", "issueURL", "diagnosticSha256"):
            task.pop(key, None)
        pid = held["perekId"]
        task.update(pasuk=verse,
            label=template["label"].rsplit(" ", 1)[0] + " " + hebrew_number(verse),
            canonicalWords=[{"pasuk": word.pasuk, "segment": word.segment, "text": word.text}
                            for word in words if word.pasuk == verse],
            originalConcern={"kind": "complete-chapter-validation", "validationSha256": validation_sha,
                             "reason": held["reason"]})
        if case and decision and decision.get("verdict") == "good":
            previous_sha = digest_json(decision)
            task.update(taskId=f"chapter-check-{pid}-{verse}-{validation_sha[:12]}-{previous_sha[:12]}",
                kind="review-cuts", caseRef={"caseId": case["id"],
                    "candidateSha256": case["candidateSha256"], "clipSha256": case["clipSha256"]},
                chapterConcern={"validationSha256": validation_sha, "previousReviewSha256": previous_sha,
                    "reasonCode": reason, "segments": sorted(segments or {row["segment"] for row in case["words"]})})
        else:
            task.update(taskId=f"chapter-location-{pid}-{verse}-{validation_sha[:12]}", kind="locate-source-range")
        return task

    def _validation_followups(self, summary, pids, tasks, cases, decisions):
        """A real failed chapter check creates a new concern, never erases earlier GOODs."""
        from listening_machine import canonical_words
        validation_sha = digest_json(summary)
        templates = {task["perekId"]: task for task in tasks}
        definitions = []
        for held in summary["held"]:
            pid = held["perekId"]
            if pid not in pids:
                continue
            template = templates[pid]
            evidence = template["sourceEvidence"]
            raw = Path(evidence["manifestPath"]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != evidence["manifestSha256"]:
                raise ValueError("A chapter validation source changed before follow-up preparation")
            focus, reason = self._validation_focus(json.loads(raw), pid, held, cases, decisions)
            words = canonical_words(Path(evidence["canonicalPath"]), evidence["canonicalSha256"], pid)
            for verse, segments in focus.items():
                case = cases.get(f"{pid}-{verse}")
                decision = decisions.get(case["id"]) if case else None
                definitions.append(self._followup_definition(template, held, verse, segments,
                    words, validation_sha, case, decision, reason))
        if definitions:
            self.actions.seed(definitions)
        return len(definitions)

    def _link_current_candidates(self, tasks, public_tasks, cases):
        """One new exact verse candidate covers all concerns for that same original verse."""
        changed = False
        for task in tasks:
            if task["kind"] == "source-remediation" or public_tasks[task["taskId"]]["state"] == "needs_source":
                continue
            case = cases.get(f"{task['perekId']}-{task['pasuk']}")
            if (case is None or case["audioSha256"] != task["audioSha256"]
                    or case["textSha256"] != task["textSha256"]
                    or Path(case["manifestPath"]).resolve() != Path(task["sourceEvidence"]["manifestPath"]).resolve()):
                continue
            ref = {"caseId": case["id"], "candidateSha256": case["candidateSha256"],
                   "clipSha256": case["clipSha256"]}
            if public_tasks[task["taskId"]].get("caseRef") == ref:
                continue
            identity = [{key: word[key] for key in ("pasuk", "segment", "text")} for word in case["words"]]
            if identity != task["canonicalWords"]:
                raise ValueError("A replacement concern candidate changed canonical word identities")
            self._task_state(task["taskId"], "review", {"caseRef": ref,
                "reasonCode": "current_source_bound_verse_candidate"})
            changed = True
        return changed

    def _remaining_task(self, task, public_task, cases, decisions):
        """Count only an unresolved concern bound to the current exact verse candidate."""
        current = cases.get(f"{task['perekId']}-{task['pasuk']}")
        decision = decisions.get(current["id"]) if current else None
        ref = public_task.get("caseRef")
        linked = bool(current and ref and ref == {"caseId": current["id"],
            "candidateSha256": current["candidateSha256"], "clipSha256": current["clipSha256"]})
        source_pending = public_task["state"] == "needs_source"
        good = bool(task["kind"] != "source-remediation" and not source_pending and linked and decision
                    and decision.get("verdict") == "good"
                    and digest_json(decision) != task.get("chapterConcern", {}).get("previousReviewSha256"))
        if task["kind"] != "source-remediation" and not source_pending and linked and not good:
            self._task_state(task["taskId"], "review", {"caseRef": ref,
                "reasonCode": task.get("chapterConcern", {}).get("reasonCode") or (
                    "review_reported_problem" if decision and decision.get("verdict") in ("problem", "skip")
                    else "review_word_cuts")})
        return 0 if good else 1

    def _chapter_progress(self, recorded, ready, grouped, public_tasks, cases, decisions):
        """Build truthful chapter totals independently of visible review-page capacity."""
        complete, chapters = [], []
        for pid in sorted(recorded):
            remaining = sum(self._remaining_task(task, public_tasks[task["taskId"]], cases, decisions)
                            for task in grouped[pid])
            if pid not in ready and grouped[pid] and not remaining:
                complete.append(pid)
            fallback = grouped[pid][0]["label"].rsplit(" ", 1)[0] if grouped[pid] else str(pid)
            chapters.append({"perekId": pid, "label": self.chapter_labels.get(pid) or fallback,
                "state": "ready" if pid in ready else "validating" if pid in complete else "needs_actions",
                "remainingActions": remaining if grouped[pid] else (0 if pid in ready else 1)})
        return complete, chapters

    def _import_preview(self, folder):
        """Preserve failed previews and retry operational failures from the current durable mirror."""
        preview = folder / "current-preview.sqlite"
        shutil.copy2(self.result, preview)
        self._save(state="validating_chapters")
        try:
            with original_audio_errors("Original audio verification failed"):
                summary = self.importer(folder / "queue.json", folder / "reviews.json",
                                        self.paths["canonicalPath"], folder / "accepted", preview)
        except (ValueError, KeyError, TypeError, OSError, sqlite3.Error, RuntimeError):
            failed = folder / ("failed-preview-" + digest_file(preview) + ".sqlite")
            if not failed.exists():
                shutil.copy2(preview, failed)
            raise
        if summary["accepted"] or summary["updatedReviews"] or summary["withdrawn"]:
            temporary = self.result.with_suffix(".next.sqlite")
            shutil.copy2(preview, temporary)
            temporary.replace(self.result)
            self.ledger["resultSha256"] = digest_file(self.result)
        return summary

    def _resolved_chapters(self, complete, after_ready, grouped, decisions, validation_sha):
        """Mark concerns resolved only after genuine saved GOODs pass complete chapter validation."""
        for pid in complete:
            if pid not in after_ready:
                continue
            for task in grouped[pid]:
                decision = decisions.get(f"{pid}-{task['pasuk']}")
                if decision and decision.get("verdict") == "good":
                    self._task_state(task["taskId"], "resolved", {
                        "genuineGoodValidated": True, "chapterValidated": True,
                        "reviewSha256": digest_json(decision), "chapterValidationSha256": validation_sha})

    def _validate_chapters(self, feedback, complete, reconsider, tasks, grouped, cases,
                           decisions, chapters, recorded):
        """Commit only an isolated successful local result and retain all exact feedback evidence."""
        fingerprint = digest_json(feedback)
        folder = self._evidence(feedback)
        summary = self._import_preview(folder)
        self.ledger["feedbackAttemptSha256"] = fingerprint
        validation_sha = digest_json(summary)
        _recorded, after_ready = self._ready()
        self._validation_followups(summary, set(complete) - after_ready, tasks, cases, decisions)
        self._resolved_chapters(complete, after_ready, grouped, decisions, validation_sha)
        self.ledger["validation"] = {"summary": summary, "sha256": validation_sha, "evidence": str(folder)}
        self.ledger["feedbackSha256"] = fingerprint
        for row in chapters:
            if row["perekId"] in after_ready:
                row.update(state="ready", remainingActions=0)
            elif row["perekId"] in complete or row["perekId"] in reconsider:
                row.update(state="needs_actions", remainingActions=max(1, row["remainingActions"]))
        self._save(state="waiting_for_actions", readyRecordings=len(after_ready),
                   pendingRecordings=len(recorded - after_ready), chapters=chapters)

    def refresh(self):
        """Keep reported problems actionable and validate only complete genuine GOOD chapters."""
        feedback = self.fetch("/api/export")
        cases = self._cases()
        reviews_path = self.state / "actual-reviews.json"
        write_state_json(reviews_path, feedback)
        decisions = current_review_decisions({"cases": list(cases.values())}, reviews_path)
        self._source_holds()
        recorded, ready = self._ready()
        tasks = self.actions.tasks(private=True)
        public_tasks = {row["taskId"]: row for row in self.actions.public_view()["tasks"]}
        if self._link_current_candidates(tasks, public_tasks, cases):
            public_tasks = {row["taskId"]: row for row in self.actions.public_view()["tasks"]}
        grouped = defaultdict(list)
        for task in tasks:
            grouped[task["perekId"]].append(task)
        complete, chapters = self._chapter_progress(recorded, ready, grouped, public_tasks, cases, decisions)
        self._save(state="waiting_for_actions", totalRecordings=len(recorded), readyRecordings=len(ready),
                   pendingRecordings=len(recorded - ready), chapters=chapters)
        reconsider = [pid for pid in ready if any(
            decisions.get(f"{pid}-{task['pasuk']}", {}).get("verdict") in ("problem", "skip")
            for task in grouped[pid])]
        fingerprint = digest_json(feedback)
        if ((complete or reconsider) and self.ledger.get("feedbackSha256") != fingerprint
                and self.ledger.get("feedbackAttemptSha256") != fingerprint):
            self._validate_chapters(feedback, complete, reconsider, tasks, grouped, cases,
                                    decisions, chapters, recorded)

    def run(self, once=False):
        """Keep one local owner; a stopped assistant schedule is not needed for completion."""
        with WorkerLock(self.state / "worker.lock"):
            try:
                self.seed()
            except (ValueError, KeyError, TypeError, OSError, sqlite3.Error, RuntimeError) as error:
                write_state_json(self.state / "workflow-error.json", {"error": str(error), "recordedAt": now()})
                self._save(state="workflow_error", reasonCode="action_preparation_requires_attention")
                raise
            while True:
                try:
                    self._process_contexts()
                    self.refresh()
                except (ValueError, KeyError, TypeError, OSError, sqlite3.Error, RuntimeError) as error:
                    write_state_json(self.state / "workflow-error.json", {"error": str(error), "recordedAt": now()})
                    self._save(state="workflow_error", reasonCode="validation_requires_attention")
                if once:
                    return self.status
                time.sleep(self.config.get("pollSeconds", 5))


def main():
    """Run only an explicitly configured local concern workflow."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--once", action="store_true")
    arguments = parser.parse_args()
    print(json.dumps(ConcernWorkflow(read_state_json(arguments.config)).run(arguments.once), ensure_ascii=False))


if __name__ == "__main__":
    main()
