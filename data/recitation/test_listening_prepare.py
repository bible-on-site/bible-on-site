"""Local preparation is bounded, restartable and never a timing approval."""

from contextlib import ExitStack, closing, redirect_stdout
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
import wave

from alignment import load_chapters, text_hash, words_for
from listening_files import open_state_text, read_state_json, write_state_json
from listening_prepare import COMPLETED_DIAGNOSTICS, PreparationWorker, WorkerLock, main
from listening_review import digest_file, read_json, write_json


class LocalPreparationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.job = self.root / "completed-job"
        self.source = self.job / "source"
        (self.source / "alignments").mkdir(parents=True)
        self.recordings = self.root / "recordings"
        self.recordings.mkdir()
        self.canonical = self.root / "canonical.json"
        texts = (("ויהי", "אור"), ("בראשית", "ברא"), ("את", "השמים"), ("והארץ", "טובה"))
        chapters = [{"perekId": pid, "pesukim": [
            {"segments": [{"type": "qri", "value": word} for word in verse]} for verse in texts]}
            for pid in range(1, 9)]
        write_json(self.canonical, [{"name": "בראשית", "perekFrom": 1, "perakim": chapters}])
        self.chapters = load_chapters(self.canonical)
        self.targets = []
        self.raw_studies = {}
        for pid in self.chapters:
            words = words_for(self.chapters[pid])
            audio = self.recordings / f"{pid}_record.mp3"
            audio.write_bytes(f"exact original recording {pid}".encode())
            rows = [{"pasuk": word.pasuk, "segment": word.segment, "text": word.text,
                     "startMs": 100 + index * 500, "endMs": 400 + index * 500,
                     "textScore": 1., "acousticScore": .9} for index, word in enumerate(words)]
            manifest = {"perekId": pid, "audioSha256": digest_file(audio),
                        "textSha256": text_hash(words), "durationMs": 5000, "words": rows}
            write_json(self.source / "alignments" / f"{pid}.json", manifest)
            write_json(self.source / f"{pid}.review.json", {"review": []})
            write_json(self.source / f"{pid}.asr.json", {"words": [{"text": word.speech} for word in words]})
            write_json(self.source / f"{pid}-diagnostic-summary.json", {"perekId": pid})
        write_json(self.job / "status.json", {"state": COMPLETED_DIAGNOSTICS})
        self.database = self.root / "publication.sqlite"
        with closing(sqlite3.connect(self.database)) as database:
            database.execute("CREATE TABLE recitation_track(perek_id INTEGER,alignment_status TEXT)")
            database.commit()
        self.plan = self.root / "selective-plan.json"
        self.config = {"version": 1, "planPath": str(self.plan), "jobRoot": str(self.job),
                       "canonicalPath": str(self.canonical), "recordings": str(self.recordings),
                       "batchRoot": str(self.root / "batches"), "stateDirectory": str(self.root / "state"),
                       "publicationDatabase": str(self.database), "reviewStore": str(self.root / "reviews.sqlite"),
                       "reviewUrl": "http://127.0.0.1:8792/", "targetVisible": 20, "maxVisibleCuts": 150,
                       "pollSeconds": 1, "knownSourceHoldIds": [8]}
        self.inventory = {"offeredCaseIds": [], "visibleCaseIds": [], "visibleWordCuts": 0,
                          "revision": "actual-initial-inventory"}
        self.appended = []

    def add_target(self, pid, verse=2, **changes):
        raw_path = self.job / "diagnostics" / f"{pid}-{verse}.json"
        write_json(raw_path, {"perekId": pid, "pasuk": verse, "rawEvidence": "immutable fixture"})
        target = {"perekId": pid, "pasuk": verse, "missingBoundarySegments": [1, 2],
                  "invalidDurationWords": [], "knownSourceDefectHold": False, "contextHoldReason": None,
                  "rawDiagnostic": {"path": str(raw_path), "sha256": digest_file(raw_path)}, **changes}
        self.targets.append(target)
        manifest = read_json(self.source / "alignments" / f"{pid}.json")
        rows = [{key: value for key, value in row.items() if key != "textScore"}
                for row in manifest["words"] if row["pasuk"] == verse]
        self.raw_studies[(pid, verse)] = {"diagnosticOnly": True, "automaticApproval": False, "cases": [{
            "perekId": pid, "pasuk": verse, "contextStartSec": 0., "contextEndSec": 5.,
            "diagnosticCandidates": rows, "originalReasons": ["missing original ASR anchor"],
            "automaticApproval": False, "sourceInspectionPerformed": False,
            "requiresGenuineFreshCutHearing": True}]}
        return target

    def worker(self, **changes):
        write_json(self.plan, {"targets": self.targets})
        self.config["planSha256"] = digest_file(self.plan)
        return PreparationWorker({**self.config, **changes})

    def build_study(self, path, sha, summary, source, canonical, recording, decoded_pcm=None, *, plan_path=None):
        self.assertEqual(digest_file(path), sha)
        raw = read_json(path)
        self.assertEqual(source, self.source)
        self.assertEqual(canonical, self.canonical)
        self.assertEqual(summary, self.source / f"{raw['perekId']}-diagnostic-summary.json")
        self.assertEqual(recording, self.recordings / f"{raw['perekId']}_record.mp3")
        self.assertEqual(plan_path, self.plan)
        self.assertIsNotNone(decoded_pcm)
        return deepcopy(self.raw_studies[(raw["perekId"], raw["pasuk"])])

    @staticmethod
    def clip(_audio, destination, start, end):
        with wave.open(str(destination), "wb") as stream:
            stream.setparams((1, 4, 16000, 0, "NONE", "not compressed"))
            stream.writeframes(bytes((end - start) * 16 * 4))
        return "original decoded fixture PCM"

    def append(self, path):
        queue = read_json(path)
        cases = queue["cases"]
        keys = [case["id"] for case in cases]
        self.assertFalse(set(keys) & set(self.inventory["offeredCaseIds"]))
        self.appended.append((path, deepcopy(queue)))
        self.inventory["offeredCaseIds"].extend(keys)
        self.inventory["visibleCaseIds"].extend(keys)
        self.inventory["visibleWordCuts"] += sum(len(case["words"]) for case in cases)
        self.inventory["revision"] = "actual-after-" + str(len(self.appended))

    def isolated(self, worker):
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.builder = stack.enter_context(patch("listening_prepare.build_machine_study", side_effect=self.build_study))
        self.decoder = stack.enter_context(patch("listening_machine.decode_source", return_value=b"original decoded PCM",
                                                create=True))
        stack.enter_context(patch("listening_prepare.make_clip", side_effect=self.clip))
        stack.enter_context(patch.object(worker, "_workload", side_effect=lambda: deepcopy(self.inventory)))
        stack.enter_context(patch.object(worker, "_append", side_effect=self.append))
        return stack

    def http_fixture(self, value):
        class WorkloadHandler(BaseHTTPRequestHandler):
            """Serve only the isolated fixture's fixed workload response."""

            def do_GET(self):
                """Record the actual client route and return the fixture inventory."""
                self.server.paths.append(self.path)
                body = json.dumps(self.server.value).encode()
                self.send_response(self.server.response_status)
                if self.server.response_status == 302:
                    self.send_header("Location", "http://example.invalid/must-not-be-followed")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                """Keep fixture request logs out of the unit-test output."""

        server = ThreadingHTTPServer(("127.0.0.1", 0), WorkloadHandler)
        server.value, server.response_status, server.paths = value, 200, []
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def close():
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
        self.addCleanup(close)
        return server

    def test_only_real_selective_targets_reach_preparation_and_all_other_reasons_stay_explicit(self):
        self.add_target(1)
        self.add_target(2)
        self.add_target(3)
        self.add_target(4, contextHoldReason="missing actual adjacent context")
        self.add_target(5, knownSourceDefectHold=True)
        self.add_target(6, rawDiagnostic=None)
        self.add_target(8)
        with closing(sqlite3.connect(self.database)) as database:
            database.execute("INSERT INTO recitation_track VALUES(2,'ready')")
            database.commit()
        self.inventory["offeredCaseIds"] = ["3-2"]
        worker = self.worker()
        self.isolated(worker)
        before = self.database.read_bytes()
        status = worker.prepare_all()
        states = {key: (row["state"], row["reason"]) for key, row in worker.ledger["cases"].items()}
        self.assertEqual(states, {"1-2": ("prepared", "awaiting_queue_capacity"),
            "2-2": ("excluded", "chapter_already_ready"), "3-2": ("excluded", "previously_offered_chapter"),
            "4-2": ("held", "chapter_requires_supported_context"), "5-2": ("held", "known_original_source_hold"),
            "6-2": ("held", "chapter_requires_supported_context"), "8-2": ("held", "known_original_source_hold")})
        self.assertEqual(self.builder.call_count, 1)
        self.assertEqual(self.database.read_bytes(), before)
        self.assertEqual((status["newInferenceRuns"], status["automaticApprovals"], status["publicationWrites"]), (0, 0, 0))
        self.assertIs(status["manualSourceInspection"], False)
        self.assertEqual(status["machinePreparedVerses"], 1)
        self.assertEqual(self.appended, [])

    def test_whole_chapter_is_checked_once_and_machine_rows_never_become_approvals(self):
        self.add_target(1, 2)
        self.add_target(1, 3)
        worker = self.worker()
        self.isolated(worker)
        from listening_accept import merged_words
        with patch("listening_prepare.merged_words", wraps=merged_words) as merged:
            worker.prepare_all()
        self.assertEqual(merged.call_count, 1)
        self.assertEqual(set(merged.call_args.args[4]), {2, 3})
        self.assertEqual(self.decoder.call_count, 1)
        row = worker.ledger["cases"]["1-2"]
        queue = read_json(Path(row["groupQueue"]))
        self.assertEqual(len(queue["cases"]), 2)
        proof = read_json(Path(row["groupQueue"]).with_name("verification.json"))
        self.assertIs(proof["automaticApproval"], False)
        self.assertIs(proof["manualSourceInspection"], False)
        for case in queue["cases"]:
            self.assertEqual(case["words"], self.raw_studies[(1, case["pasuk"])]["cases"][0]["diagnosticCandidates"])
            self.assertEqual(case["publicationStatus"], "held")
            self.assertIs(case["manualSourceInspection"], False)
            self.assertIs(case["requiresFreshHumanCutReview"], True)
            self.assertNotIn("reusableHeardSegments", case)

    def test_one_bad_target_holds_the_complete_chapter_without_a_partial_queue(self):
        self.add_target(1, 2)
        self.add_target(1, 3)
        self.raw_studies[(1, 3)]["cases"][0]["diagnosticCandidates"][0]["startMs"] = 2500
        worker = self.worker()
        self.isolated(worker)
        worker.prepare_all()
        self.assertEqual({row["state"] for row in worker.ledger["cases"].values()}, {"held"})
        self.assertEqual({row["reason"] for row in worker.ledger["cases"].values()}, {"source_or_full_chapter_guard"})
        self.assertEqual(list(Path(self.config["batchRoot"]).rglob("queue.json")), [])
        self.assertEqual(self.appended, [])

    def test_invalid_automatic_remainder_is_held_even_with_a_good_target_geometry(self):
        self.add_target(1)
        path = self.source / "alignments/1.json"
        manifest = read_json(path)
        manifest["words"][-1]["textScore"] = .1
        write_json(path, manifest)
        worker = self.worker()
        self.isolated(worker)
        worker.prepare_all()
        row = worker.ledger["cases"]["1-2"]
        self.assertEqual(row["state"], "held")
        self.assertIn("Automatic text evidence", row["detail"])
        self.assertEqual(self.appended, [])

    def test_restart_uses_immutable_prepared_groups_without_redecoding_or_rebuilding(self):
        self.add_target(1)
        worker = self.worker()
        first = self.isolated(worker)
        worker.prepare_all()
        original = Path(worker.ledger["cases"]["1-2"]["groupQueue"]).read_bytes()
        first.close()
        resumed = PreparationWorker(self.config)
        self.isolated(resumed)
        resumed.prepare_all()
        self.assertEqual(self.builder.call_count, 0)
        self.assertEqual(self.decoder.call_count, 0)
        self.assertEqual(resumed.refill(), 1)
        self.assertEqual(Path(resumed.ledger["cases"]["1-2"]["groupQueue"]).read_bytes(), original)
        self.assertEqual(resumed.refill(), 0)
        self.assertEqual(len(self.appended), 1)

    def test_refill_respects_current_verse_and_cut_budgets_and_never_replaces_a_prior_good(self):
        for pid in (1, 2, 3):
            self.add_target(pid)
        worker = self.worker(targetVisible=3, maxVisibleCuts=5)
        self.isolated(worker)
        worker.prepare_all()
        self.inventory.update(offeredCaseIds=["old-verse", "1-2"], visibleCaseIds=["old-verse"], visibleWordCuts=3)
        self.assertEqual(worker.refill(), 1)
        self.assertEqual([case["id"] for case in self.appended[0][1]["cases"]], ["2-2"])
        self.assertEqual(worker.ledger["cases"]["1-2"]["state"], "queued")
        self.assertEqual(worker.ledger["cases"]["3-2"]["state"], "prepared")
        self.assertEqual(self.inventory["visibleCaseIds"], ["old-verse", "2-2"])
        self.assertEqual(self.inventory["visibleWordCuts"], 5)
        self.assertEqual(worker.refill(), 0)
        self.inventory.update(visibleCaseIds=["old-verse"], visibleWordCuts=3)
        self.assertEqual(worker.refill(), 1)
        self.assertEqual([case["id"] for case in self.appended[1][1]["cases"]], ["3-2"])

    def test_refill_does_not_exceed_verse_capacity_when_cut_capacity_is_available(self):
        self.add_target(1)
        self.add_target(2)
        worker = self.worker(targetVisible=2, maxVisibleCuts=150)
        self.isolated(worker)
        worker.prepare_all()
        self.inventory.update(offeredCaseIds=["existing"], visibleCaseIds=["existing"], visibleWordCuts=1)
        self.assertEqual(worker.refill(), 1)
        self.assertEqual(len(self.inventory["visibleCaseIds"]), 2)
        self.assertEqual(worker.refill(), 0)

    def test_queue_writer_conflict_keeps_case_prepared_and_retry_checks_actual_inventory(self):
        self.add_target(1)
        worker = self.worker()
        self.isolated(worker)
        worker.prepare_all()
        with patch.object(worker, "_append", side_effect=ValueError("concurrent case was already offered")):
            with self.assertRaisesRegex(ValueError, "already offered"):
                worker.refill()
        self.assertEqual(worker.ledger["cases"]["1-2"]["state"], "prepared")
        self.inventory["offeredCaseIds"].append("1-2")
        self.assertEqual(worker.refill(), 0)
        self.assertEqual(worker.ledger["cases"]["1-2"]["state"], "queued")
        self.assertEqual(self.appended, [])

    def test_append_requires_actual_postwrite_inventory_before_claiming_delivery(self):
        self.add_target(1)
        worker = self.worker()
        self.isolated(worker)
        worker.prepare_all()
        with patch.object(worker, "_append", return_value=None):
            with self.assertRaisesRegex(ValueError, "missing from the actual"):
                worker.refill()
        self.assertEqual(worker.ledger["cases"]["1-2"]["state"], "prepared")

    def test_changed_prepared_queue_and_changed_plan_fail_closed(self):
        self.add_target(1)
        worker = self.worker()
        self.isolated(worker)
        worker.prepare_all()
        queue_path = Path(worker.ledger["cases"]["1-2"]["groupQueue"])
        queue_path.write_text(queue_path.read_text(encoding="utf-8") + " ", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "immutable source group changed"):
            worker.refill()
        self.assertEqual(self.appended, [])
        write_json(self.plan, {"targets": []})
        with self.assertRaisesRegex(ValueError, "selective repair plan changed"):
            PreparationWorker(self.config)

    def test_active_or_failed_diagnostic_job_cannot_be_consumed(self):
        self.add_target(1)
        worker = self.worker()
        self.isolated(worker)
        for state in ("running", "failed"):
            write_json(self.job / "status.json", {"state": state})
            with self.subTest(state=state), self.assertRaisesRegex(ValueError, "completed diagnostic job"):
                worker.prepare_all()
        self.assertEqual(self.builder.call_count, 0)
        self.assertEqual(self.appended, [])

    def test_ready_chapter_after_preparation_is_not_reoffered_when_capacity_opens(self):
        self.add_target(1)
        worker = self.worker()
        self.isolated(worker)
        worker.prepare_all()
        with closing(sqlite3.connect(self.database)) as database:
            database.execute("INSERT INTO recitation_track VALUES(1,'ready')")
            database.commit()
        self.assertEqual(worker.refill(), 0)
        self.assertEqual(worker.ledger["cases"]["1-2"]["state"], "excluded")
        self.assertEqual(self.appended, [])

    def test_protected_source_output_paths_are_rejected_before_creating_directories(self):
        self.add_target(1)
        self.worker()
        for key in ("stateDirectory", "batchRoot"):
            for prefix in (self.job, self.root / "alias" / ".." / self.job.name):
                destination = prefix / ("must-not-create-" + key)
                with self.subTest(path=key, prefix=prefix), self.assertRaisesRegex(
                        ValueError, "completed diagnostic source job"):
                    PreparationWorker({**self.config, key: str(destination)})
                self.assertFalse(destination.resolve().exists(), "Rejected configuration must not modify job evidence")

    def test_long_lived_worker_rechecks_immutable_inputs_before_preparing_or_refilling(self):
        self.add_target(1)
        worker = self.worker()
        self.isolated(worker)
        write_json(self.plan, {"targets": self.targets, "laterEdit": "must be rejected"})
        with self.assertRaisesRegex(ValueError, "plan changed"):
            worker.prepare_all()
        self.assertEqual(self.builder.call_count, 0)
        write_json(self.plan, {"targets": self.targets})
        worker.prepare_all()
        canonical = self.canonical.read_bytes()
        self.canonical.write_bytes(canonical + b" ")
        with self.assertRaisesRegex(ValueError, "[Cc]anonical.*changed"):
            worker.refill()
        self.assertEqual(self.appended, [])

    def test_no_second_worker_and_lock_is_released_on_normal_or_exceptional_exit(self):
        lock = self.root / "state/worker.lock"
        with WorkerLock(lock):
            with self.assertRaisesRegex(RuntimeError, "already owns"):
                with WorkerLock(lock):
                    self.fail("A second worker entered the same preparation job")

        def fail_owned_job():
            """Exercise a real exception while the worker owns its lease."""
            with WorkerLock(lock):
                raise ValueError("test failure")
        self.assertRaisesRegex(ValueError, "test failure", fail_owned_job)
        with WorkerLock(lock):
            self.assertTrue(lock.exists())

    def test_configuration_rejects_remote_access_worker_checkpoint_and_noninteger_limits(self):
        self.add_target(1)
        self.worker()
        for change in ({"reviewUrl": "http://example.com:8792"}, {"reviewUrl": "http://localhost:8792"},
                       {"reviewUrl": "http://127.0.0.1:8792/api/queue"},
                       {"reviewUrl": "http://user:secret@127.0.0.1:8792/"},
                       {"reviewUrl": "http://127.0.0.1:0/"},
                       {"reviewUrl": "http://127.0.0.1:65536/"},
                       {"reviewUrl": "http://127.0.0.1:not-a-port/"},
                       {"publicationDatabase": str(self.root / "recitation-working.sqlite")},
                       {"reviewStore": str(self.database)}, {"stateDirectory": "relative-state"},
                       {"reviewStore": str(self.root / "alias" / ".." / self.database.name)},
                       {"targetVisible": True}, {"maxVisibleCuts": 0}, {"pollSeconds": 1.5}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                PreparationWorker({**self.config, **change})

    def test_workload_requires_one_consistent_inventory_without_secrets_or_completion_inference(self):
        valid = {"offeredCaseIds": ["1-2", "old-good"], "visibleCaseIds": ["1-2"],
                 "visibleWordCuts": 2, "revision": "one-atomic-inventory"}
        server = self.http_fixture(valid)
        worker = self.worker(reviewUrl=f"http://127.0.0.1:{server.server_port}/")
        self.assertEqual(worker._workload(), valid)
        for changes in ({"offeredCaseIds": "1-2"}, {"offeredCaseIds": ["1-2", "1-2"]},
                        {"visibleCaseIds": ["1-2", "1-2"]}, {"visibleCaseIds": ["unoffered"]},
                        {"offeredCaseIds": [True]}, {"visibleWordCuts": True},
                        {"visibleWordCuts": -1}, {"visibleWordCuts": 0}, {"revision": ""}):
            server.value = {**valid, **changes}
            with self.subTest(changes=changes):
                with self.assertRaisesRegex(ValueError, "valid atomic preparation workload"):
                    worker._workload()
        self.assertEqual(server.paths, ["/api/preparation-workload"] * 10)

    def test_workload_rejects_redirect_or_error_instead_of_following_an_external_url(self):
        server = self.http_fixture({"not": "a workload"})
        worker = self.worker(reviewUrl=f"http://127.0.0.1:{server.server_port}/")
        for status in (302, 403, 500):
            server.response_status = status
            with self.subTest(status=status), self.assertRaisesRegex(ValueError, "HTTP " + str(status)):
                worker._workload()
        self.assertEqual(server.paths, ["/api/preparation-workload"] * 3)

    def test_append_uses_original_short_transaction_with_unseen_protection(self):
        worker = self.worker()
        queue_path = self.root / "immutable-batch/queue.json"
        with patch("listening_prepare.ReviewDatabase") as writer:
            worker._append(queue_path)
        writer.assert_called_once_with(Path(self.config["reviewStore"]).resolve())
        writer.return_value.append.assert_called_once_with(queue_path, only_unseen=True)
        writer.return_value.snapshot.assert_not_called()

    def test_changed_canonical_requires_distinct_state_instead_of_reusing_prepared_candidates(self):
        self.add_target(1)
        worker = self.worker()
        self.isolated(worker)
        worker.prepare_all()
        canonical = read_json(self.canonical)
        canonical[0]["perakim"][0]["pesukim"][1]["segments"][0]["value"] = "שינוי"
        write_json(self.canonical, canonical)
        with self.assertRaisesRegex(ValueError, "distinct job state"):
            PreparationWorker(self.config)

    def test_once_returns_waiting_with_durable_backlog_and_zero_inference_or_approval(self):
        self.add_target(1)
        worker = self.worker(targetVisible=1)
        self.isolated(worker)
        self.inventory.update(offeredCaseIds=["existing"], visibleCaseIds=["existing"], visibleWordCuts=1)
        result = worker.run(once=True)
        self.assertEqual(result["state"], "waiting_for_review_capacity")
        self.assertEqual(result["preparedWaiting"], 1)
        saved = read_json(worker.state / "status.json")
        self.assertEqual((saved["automaticApprovals"], saved["newInferenceRuns"], saved["publicationWrites"]), (0, 0, 0))
        self.assertEqual(read_json(worker.ledger_path)["cases"]["1-2"]["state"], "prepared")

    def test_waiting_heartbeats_do_not_rewrite_an_unchanged_ledger(self):
        worker = self.worker()
        first = "2026-10-22T18:00:00+00:00"
        second = "2026-10-22T18:00:05+00:00"
        with patch("listening_prepare.write_state_json", wraps=write_state_json) as writer, patch(
                "listening_prepare.now", side_effect=[first, second]):
            worker._save("waiting_for_review_capacity", visibleVerses=20)
            ledger = worker.ledger_path.read_bytes()
            worker._save("waiting_for_review_capacity", visibleVerses=20)
        paths = [call.args[0] for call in writer.call_args_list]
        self.assertEqual(paths.count(worker.ledger_path), 1)
        self.assertEqual(paths.count(worker.state / "status.json"), 2)
        self.assertEqual(worker.ledger_path.read_bytes(), ledger)
        self.assertEqual(read_state_json(worker.state / "status.json")["updatedAt"], second)

    def test_changed_ledger_is_persisted_and_loaded_with_replacement_safe_reading(self):
        self.add_target(1)
        worker = self.worker()
        worker._save("preparing")
        worker.ledger["cases"]["1-2"] = {"perekId": 1, "pasuk": 2,
            "state": "held", "reason": "source_or_full_chapter_guard", "detail": "real unresolved source context"}
        with patch("listening_prepare.write_state_json", wraps=write_state_json) as writer:
            worker._save("prepared")
        self.assertEqual([call.args[0] for call in writer.call_args_list].count(worker.ledger_path), 1)
        with patch("listening_prepare.read_state_json", wraps=read_state_json) as reader:
            resumed = PreparationWorker(self.config)
        reader.assert_called_once_with(worker.ledger_path)
        self.assertEqual(resumed.ledger, worker.ledger)
        with patch("listening_prepare.write_state_json", wraps=write_state_json) as writer:
            resumed._save("waiting_for_review_capacity")
        self.assertEqual([call.args[0] for call in writer.call_args_list], [worker.state / "status.json"])

    def test_progress_persists_while_monitors_hold_previous_state_generations(self):
        self.add_target(1)
        worker = self.worker()
        worker._save("preparing")
        status_path = worker.state / "status.json"
        with open_state_text(worker.ledger_path) as old_ledger, open_state_text(status_path) as old_status:
            previous_ledger, previous_status = json.load(old_ledger), json.load(old_status)
            worker.ledger["cases"]["1-2"] = {"perekId": 1, "pasuk": 2,
                "state": "held", "reason": "source_or_full_chapter_guard"}
            worker._save("waiting_for_review_capacity", visibleVerses=18)
            old_ledger.seek(0)
            old_status.seek(0)
            self.assertEqual(json.load(old_ledger), previous_ledger)
            self.assertEqual(json.load(old_status), previous_status)
        self.assertEqual(read_state_json(worker.ledger_path), worker.ledger)
        current = read_state_json(status_path)
        self.assertEqual((current["state"], current["visibleVerses"]), ("waiting_for_review_capacity", 18))
        self.assertEqual(current["counts"], {"held": 1})

    def test_status_only_prints_actual_fields_without_constructing_a_worker_or_taking_actions(self):
        state = self.root / "read-only-state"
        status_path = state / "status.json"
        actual = {"state": "waiting_for_review_capacity", "pid": 123,
                  "updatedAt": "2026-10-22T18:00:05+00:00", "counts": {"queued": 7, "prepared": 36},
                  "futureField": {"keep": [False, "שלום"]}}
        write_json(status_path, actual)
        config_path = self.root / "status-only-config.json"
        write_json(config_path, {"stateDirectory": str(state)})
        before = status_path.read_bytes()
        output = StringIO()
        with ExitStack() as stack:
            stack.enter_context(patch("sys.argv", ["listening_prepare.py", "--config", str(config_path), "--status-only"]))
            for name in ("PreparationWorker", "WorkerLock", "ReviewDatabase", "build_machine_study", "make_clip"):
                stack.enter_context(patch("listening_prepare." + name, side_effect=AssertionError("Status reading took action")))
            reader = stack.enter_context(patch("listening_prepare.read_state_json", wraps=read_state_json))
            stack.enter_context(redirect_stdout(output))
            main()
        self.assertEqual(json.loads(output.getvalue()), actual)
        self.assertEqual([call.args[0] for call in reader.call_args_list], [config_path, status_path])
        self.assertEqual(status_path.read_bytes(), before)
        self.assertEqual(list(state.iterdir()), [status_path])

    def test_missing_status_is_not_a_request_to_create_state_or_start_work(self):
        state = self.root / "not-created"
        config_path = self.root / "status-only-config.json"
        write_json(config_path, {"stateDirectory": str(state)})
        with patch("sys.argv", ["listening_prepare.py", "--config", str(config_path), "--status-only"]), patch(
                "listening_prepare.PreparationWorker", side_effect=AssertionError("Status request started a worker")):
            with self.assertRaises(FileNotFoundError):
                main()
        self.assertFalse(state.exists())


if __name__ == "__main__":
    unittest.main()
