"""Prepare local diagnostic candidates without inference, approval or publication."""
import argparse
from collections import Counter, defaultdict
from contextlib import closing
from copy import deepcopy
from datetime import datetime, timezone
from http.client import HTTPConnection
import json
import os
from pathlib import Path
import sqlite3
import time
from urllib.parse import urlsplit
import uuid

from alignment import load_chapters, words_for
from listening_accept import merged_words
from listening_files import read_state_json, write_state_json
from listening_machine import build_machine_study
from listening_queue import ReviewDatabase
from listening_review import (candidate_digest, chapter_labels, digest_file, digest_json,
                              hebrew_number, load_queue, make_clip, read_json,
                              validate_case, write_json)

POLICY = "local-listening-preparation-v1"
COMPLETED_DIAGNOSTICS = "raw_diagnostic_pass_complete_source_inspection_and_human_hearing_still_required"
PATHS = ("planPath", "jobRoot", "canonicalPath", "recordings", "batchRoot",
         "stateDirectory", "publicationDatabase", "reviewStore")


def now():
    """Return one timezone-aware timestamp for durable preparation evidence."""
    return datetime.now(timezone.utc).isoformat()


class WorkerLock:
    """An OS-owned lock is released even after a process crash, without stale deletion."""

    def __init__(self, path):
        """Bind a lock file without acquiring another worker's ownership."""
        self.path = Path(path)
        self.stream = None

    def __enter__(self):
        """Acquire exclusive nonblocking ownership for this process lifetime."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.stream = self.path.open("a+b")
        self.stream.seek(0, os.SEEK_END)
        if not self.stream.tell():
            self.stream.write(b" ")
            self.stream.flush()
        self.stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.stream.close()
            self.stream = None
            raise RuntimeError("A local preparation worker already owns this job") from error
        return self

    def __exit__(self, *_args):
        """Release ownership after either a normal exit or a worker failure."""
        if self.stream:
            if os.name == "nt":
                import msvcrt
                self.stream.seek(0)
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_UNLCK, 1)
            self.stream.close()


class PreparationWorker:
    """Resume verified local candidates and replenish bounded human review work."""

    def __init__(self, config):
        """Validate isolated paths, loopback transport and immutable job inputs."""
        self.config = deepcopy(config)
        if config.get("version") != 1:
            raise ValueError("Unknown local preparation configuration")
        configured_paths = {key: Path(config[key]) for key in PATHS}
        if any(not path.is_absolute() for path in configured_paths.values()):
            raise ValueError("Every local preparation path must be absolute")
        self.paths = {key: path.resolve() for key, path in configured_paths.items()}
        if self.paths["publicationDatabase"].name.casefold() == "recitation-working.sqlite":
            raise ValueError("Never read a worker checkpoint for review preparation")
        if self.paths["reviewStore"] == self.paths["publicationDatabase"]:
            raise ValueError("The review writer cannot target publication data")
        parsed = urlsplit(config["reviewUrl"])
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
                or parsed.username or parsed.password or parsed.path not in ("", "/")
                or parsed.query or parsed.fragment):
            raise ValueError("Use the existing loopback review application")
        self.port = parsed.port if parsed.port is not None else 80
        if not 1 <= self.port <= 65535:
            raise ValueError("The loopback review application requires a valid port")
        for key, default in (("targetVisible", 20), ("maxVisibleCuts", 150), ("pollSeconds", 5)):
            value = config.get(key, default)
            if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                raise ValueError("Preparation limits must be positive integers")
            self.config[key] = value
        self.state = self.paths["stateDirectory"]
        for output in (self.state, self.paths["batchRoot"]):
            if output.resolve().is_relative_to(self.paths["jobRoot"].resolve()):
                raise ValueError("Never write into the completed diagnostic source job")
        self.state.mkdir(parents=True, exist_ok=True)
        self.paths["batchRoot"].mkdir(parents=True, exist_ok=True)
        if digest_file(self.paths["planPath"]) != config["planSha256"]:
            raise ValueError("The immutable selective repair plan changed")
        self.plan = read_json(self.paths["planPath"])
        self.chapters = load_chapters(self.paths["canonicalPath"])
        self.labels = chapter_labels(self.paths["canonicalPath"])
        self.canonical_sha = digest_file(self.paths["canonicalPath"])
        self.fingerprint = digest_json({"policy": POLICY, "plan": config["planSha256"],
                                       "canonical": self.canonical_sha})
        self.ledger_path = self.state / "ledger.json"
        ledger_exists = self.ledger_path.exists()
        self.ledger = read_state_json(self.ledger_path) if ledger_exists else {
            "version": 1, "fingerprint": self.fingerprint, "cases": {}}
        if self.ledger.get("fingerprint") != self.fingerprint:
            raise ValueError("Use a distinct job state for changed source inputs or preparation policy")
        self._persisted_ledger = self._ledger_body() if ledger_exists else None
        targets = self.plan.get("targets", [])
        keys = [(row["perekId"], row["pasuk"]) for row in targets]
        if len(keys) != len(set(keys)):
            raise ValueError("Duplicate selective repair targets")
        self.groups = defaultdict(list)
        for row in targets:
            self.groups[row["perekId"]].append(row)
        self.status = {"state": "starting", "pid": os.getpid(), "policy": POLICY,
                       "startedAt": now(), "targetVerses": len(targets),
                       "recordings": len(self.groups), "automaticApprovals": 0,
                       "newInferenceRuns": 0, "publicationWrites": 0}

    def _save(self, state=None, **details):
        """Atomically persist the resumable ledger and truthful workload counters."""
        if state:
            self.status["state"] = state
        self.status.update(details, updatedAt=now())
        self.status["counts"] = dict(Counter(row["state"] for row in self.ledger["cases"].values()))
        self.status["remainingToPrepare"] = self.status["targetVerses"] - len(self.ledger["cases"])
        self.status["machinePreparedVerses"] = sum(row["state"] in ("prepared", "queued")
                                                   for row in self.ledger["cases"].values())
        self.status["manualSourceInspection"] = False
        self.status["holdReasons"] = dict(Counter(row["reason"] for row in self.ledger["cases"].values()
                                                   if row["state"] == "held"))
        ledger_body = self._ledger_body()
        if ledger_body != self._persisted_ledger:
            write_state_json(self.ledger_path, self.ledger)
            self._persisted_ledger = ledger_body
        write_state_json(self.state / "status.json", self.status)

    def _ledger_body(self):
        """Compare ledger content without replacing unchanged durable evidence."""
        return json.dumps(self.ledger, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    def _workload(self):
        """Read one atomic workload from the fixed local review endpoint."""
        connection = HTTPConnection("127.0.0.1", self.port, timeout=20)
        try:
            connection.request("GET", "/api/preparation-workload")
            response = connection.getresponse()
            if response.status != 200:
                raise ValueError("The local review workload request failed: HTTP " + str(response.status))
            value = json.loads(response.read())
        finally:
            connection.close()
        if not isinstance(value, dict):
            raise ValueError("The review app lacks a valid atomic preparation workload")
        offered, visible = value.get("offeredCaseIds"), value.get("visibleCaseIds")
        if (not isinstance(offered, list) or not isinstance(visible, list)
                or any(not isinstance(key, str) or not key for key in offered + visible)
                or len(offered) != len(set(offered)) or len(visible) != len(set(visible))
                or not set(visible) <= set(offered)
                or not isinstance(value.get("revision"), str) or not value["revision"]
                or not isinstance(value.get("visibleWordCuts"), int)
                or isinstance(value["visibleWordCuts"], bool)
                or value["visibleWordCuts"] < len(visible)):
            raise ValueError("The review app lacks a valid atomic preparation workload")
        return value

    def _check_inputs(self):
        """Reject changed immutable inputs before any preparation or refill."""
        if digest_file(self.paths["planPath"]) != self.config["planSha256"]:
            raise ValueError("The immutable selective repair plan changed")
        if digest_file(self.paths["canonicalPath"]) != self.canonical_sha:
            raise ValueError("Canonical source changed during local preparation")

    def _ready(self):
        """Read completed chapters through a short read-only publication connection."""
        path = self.paths["publicationDatabase"].resolve().as_uri() + "?mode=ro"
        with closing(sqlite3.connect(path, uri=True)) as database:
            return {row[0] for row in database.execute(
                "SELECT perek_id FROM recitation_track WHERE alignment_status='ready'")}

    def _record(self, targets, state, reason, **extra):
        """Keep an explicit per-target outcome without altering source evidence."""
        for target in targets:
            key = f"{target['perekId']}-{target['pasuk']}"
            self.ledger["cases"][key] = dict(state=state, reason=reason,
                perekId=target["perekId"], pasuk=target["pasuk"], updatedAt=now(), **extra)

    def _prepare_group(self, pid, targets):
        """Validate all chapter replacements before creating an immutable queue."""
        source = self.paths["jobRoot"] / "source"
        manifest_path = source / "alignments" / f"{pid}.json"
        manifest, report, asr = (read_json(manifest_path), read_json(source / f"{pid}.review.json"),
                                 read_json(source / f"{pid}.asr.json"))
        audio = self.paths["recordings"] / f"{pid}_record.mp3"
        folder = self.paths["batchRoot"] / f"machine-prepared-{pid}-{uuid.uuid4().hex}"
        folder.mkdir(exist_ok=False)
        cases, replacements = [], {}
        # One complete decoded source per chapter is shared by all model-evidence checks.
        from listening_machine import decode_source
        pcm = decode_source(audio)
        for target in sorted(targets, key=lambda item: item["pasuk"]):
            raw = target["rawDiagnostic"]
            study = build_machine_study(Path(raw["path"]), raw["sha256"],
                source / f"{pid}-diagnostic-summary.json", source,
                self.paths["canonicalPath"], audio, decoded_pcm=pcm,
                plan_path=self.paths["planPath"])
            diagnostic = study["cases"][0]
            verse = target["pasuk"]
            rows = diagnostic["diagnosticCandidates"]
            diagnostic_path = folder / f"diagnostic-{pid}-{verse}.json"
            write_json(diagnostic_path, study)
            case = {"id": f"{pid}-{verse}", "perekId": pid, "pasuk": verse,
                "label": self.labels[pid] + " " + hebrew_number(verse),
                "audioSha256": manifest["audioSha256"], "textSha256": manifest["textSha256"],
                "audioPath": str(audio.resolve()), "manifestPath": str(manifest_path.resolve()),
                "diagnosticPath": str(diagnostic_path.resolve()), "diagnosticSha256": digest_file(diagnostic_path),
                "clipStartMs": round(diagnostic["contextStartSec"] * 1000),
                "clipEndMs": round(diagnostic["contextEndSec"] * 1000), "words": deepcopy(rows),
                "originalReasons": diagnostic["originalReasons"], "heldVerseCount": len(targets),
                "publicationStatus": "held", "reviewKind": "missing", "preparationKind": "machine-suspect",
                "preparationMethod": POLICY, "manualSourceInspection": False,
                "requiresFreshHumanCutReview": True}
            validate_case(case, words_for(self.chapters[pid]), manifest)
            replacements[verse] = deepcopy(rows)
            cases.append(case)
        # Reconcile once for this chapter, never per word or repeated per case.
        merged_words(manifest, report, asr, words_for(self.chapters[pid]),
                     replacements, manifest["durationMs"])
        for case in cases:
            case["candidateSha256"] = candidate_digest(case)
            clip = folder / f"{case['id']}-{case['candidateSha256']}.wav"
            case["decoderDiagnostics"] = make_clip(audio, clip, case["clipStartMs"], case["clipEndMs"])
            case.update(clipPath=str(clip.resolve()), clipSha256=digest_file(clip))
        queue = {"version": 1, "canonicalPath": str(self.paths["canonicalPath"]),
                 "cases": cases, "excluded": [], "archivedQueues": [],
                 "publicationStatus": "held", "createdAt": now(), "queueSha256": digest_json(cases)}
        queue_path = folder / "queue.json"
        write_json(queue_path, queue)
        load_queue(queue_path)
        write_json(folder / "verification.json", {"machinePrepared": True,
            "manualSourceInspection": False, "automaticApproval": False,
            "fullChapterGeometryAndAutomaticRemainderPassed": True,
            "sourceManifestSha256": digest_file(manifest_path), "queueFileSha256": digest_file(queue_path),
            "freshHumanCutHearingRequired": True})
        for case in cases:
            self.ledger["cases"][case["id"]] = dict(state="prepared", reason="awaiting_queue_capacity",
                perekId=pid, pasuk=case["pasuk"], groupQueue=str(queue_path),
                groupQueueSha256=digest_file(queue_path), case=case, updatedAt=now())

    def prepare_all(self, refill_each=False):
        """Prepare only never-offered selective targets from a completed local job."""
        self._check_inputs()
        job_status = read_json(self.paths["jobRoot"] / "status.json")
        if job_status.get("state") != COMPLETED_DIAGNOSTICS:
            raise ValueError("Only consume a completed diagnostic job; never an active checkpoint")
        known_holds = set(self.config.get("knownSourceHoldIds", [28, 136, 231]))
        workload, ready = self._workload(), self._ready()
        offered = set(workload["offeredCaseIds"])
        ordered = sorted(self.groups.items(), key=lambda group: (
            len(group[1]), sum(len(target.get("missingBoundarySegments", [])) or 1 for target in group[1]), group[0]))
        for pid, targets in ordered:
            self._check_inputs()
            keys = [f"{pid}-{target['pasuk']}" for target in targets]
            if all(key in self.ledger["cases"] for key in keys):
                continue
            self._save("preparing", currentPerekId=pid)
            if pid in ready:
                self._record(targets, "excluded", "chapter_already_ready")
            elif any(key in offered for key in keys):
                self._record(targets, "excluded", "previously_offered_chapter")
            elif pid in known_holds or any(target.get("knownSourceDefectHold") for target in targets):
                self._record(targets, "held", "known_original_source_hold")
            elif any(not target.get("rawDiagnostic") or target.get("contextHoldReason") for target in targets):
                self._record(targets, "held", "chapter_requires_supported_context",
                             contextReasons=[target.get("contextHoldReason") for target in targets
                                             if target.get("contextHoldReason")])
            else:
                try:
                    self._prepare_group(pid, targets)
                except (ValueError, KeyError) as error:
                    self._record(targets, "held", "source_or_full_chapter_guard", detail=str(error))
            self._save()
            if refill_each:
                self.refill()
                workload, ready = self._workload(), self._ready()
                offered = set(workload["offeredCaseIds"])
        self._save("prepared")
        return self.status

    def _append(self, queue_path):
        """Append through the original short transaction, never a persistent reader."""
        ReviewDatabase(self.paths["reviewStore"]).append(queue_path, only_unseen=True)

    def refill(self):
        """Add unseen candidates within both live verse and cut capacity limits."""
        self._check_inputs()
        workload, ready = self._workload(), self._ready()
        offered = set(workload["offeredCaseIds"])
        slots = max(0, self.config["targetVisible"] - len(workload["visibleCaseIds"]))
        cut_budget = max(0, self.config["maxVisibleCuts"] - workload["visibleWordCuts"])
        prepared = []
        for key, row in self.ledger["cases"].items():
            if row["state"] not in ("prepared", "queued"):
                continue
            if key in offered:
                row.update(state="queued", reason="already_in_accumulated_queue")
            elif row["perekId"] in ready:
                row.update(state="excluded", reason="chapter_already_ready")
            elif row["state"] == "prepared":
                prepared.append(row)
        prepared.sort(key=lambda row: (len(row["case"]["words"]), row["perekId"], row["pasuk"]))
        selected = []
        checked_groups = set()
        for row in prepared:
            if not slots:
                break
            count = len(row["case"]["words"])
            if count > self.config["maxVisibleCuts"]:
                row.update(state="held", reason="verse_exceeds_configured_review_window")
                continue
            if count > cut_budget:
                continue
            path = Path(row["groupQueue"])
            if str(path) not in checked_groups:
                if digest_file(path) != row["groupQueueSha256"]:
                    raise ValueError("A prepared immutable source group changed")
                load_queue(path)
                checked_groups.add(str(path))
            selected.append(row)
            slots -= 1
            cut_budget -= count
        if selected:
            folder = self.paths["batchRoot"] / ("machine-review-" + uuid.uuid4().hex)
            folder.mkdir(exist_ok=False)
            cases = [deepcopy(row["case"]) for row in selected]
            queue = {"version": 1, "canonicalPath": str(self.paths["canonicalPath"]),
                "cases": cases, "excluded": [], "archivedQueues": [], "publicationStatus": "held",
                "createdAt": now(), "queueSha256": digest_json(cases)}
            path = folder / "queue.json"
            write_json(path, queue)
            self._append(path)
            after = self._workload()
            if not {case["id"] for case in cases} <= set(after["offeredCaseIds"]):
                raise ValueError("The appended cases are missing from the actual accumulated queue")
            for row in selected:
                row.update(state="queued", reason="awaiting_genuine_human_review", queuedAt=now(),
                           offeredQueue=str(path), offeredQueueSha256=digest_file(path))
            workload = after
        self._save(visibleVerses=len(workload["visibleCaseIds"]), visibleWordCuts=workload["visibleWordCuts"])
        return len(selected)

    def run(self, once=False):
        """Hold one worker lease while preparing and refilling the bounded backlog."""
        with WorkerLock(self.state / "worker.lock"):
            try:
                self.prepare_all(refill_each=True)
                while True:
                    self.refill()
                    remaining = sum(row["state"] == "prepared" for row in self.ledger["cases"].values())
                    if not remaining:
                        self._save("completed", finishedAt=now())
                        return self.status
                    self._save("waiting_for_review_capacity", preparedWaiting=remaining)
                    if once:
                        return self.status
                    time.sleep(self.config["pollSeconds"])
            except BaseException as error:
                self._save("failed", error=str(error), failedAt=now())
                raise


def main():
    """Run the configured local preparation job and report its durable status."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true")
    mode.add_argument("--status-only", action="store_true",
                      help="Read the current status with replacement-safe sharing; never start a worker")
    args = parser.parse_args()
    config = read_state_json(args.config)
    if args.status_only:
        state = Path(config["stateDirectory"])
        if not state.is_absolute():
            raise ValueError("The local preparation status path must be absolute")
        print(json.dumps(read_state_json(state.resolve() / "status.json"), ensure_ascii=False), flush=True)
        return
    worker = PreparationWorker(config)
    print(json.dumps(worker.run(once=args.once), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
