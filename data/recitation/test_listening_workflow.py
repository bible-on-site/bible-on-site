"""Local concern workflow routing, closed evidence and publication isolation regressions."""
from contextlib import closing
from copy import deepcopy
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch
import wave

from alignment import Word
from listening_actions import POLICY as ACTION_POLICY, task_digest
from listening_edits import verify_word_review
from listening_review import candidate_digest, digest_file, digest_json, read_json, write_json
from listening_queue import ReviewDatabase
from listening_workflow import ConcernWorkflow


class ConcernWorkflowTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.canonical = self.root / "canonical.json"
        self.plan = self.root / "plan.json"
        self.audio = self.root / "1_record.mp3"
        write_json(self.canonical, [])
        write_json(self.plan, {"targets": []})
        self.audio.write_bytes(b"original immutable source fixture")
        self.publication = self.root / "publication.sqlite"
        with closing(sqlite3.connect(self.publication)) as db, db:
            db.execute("CREATE TABLE recitation_track (perek_id INTEGER, alignment_status TEXT)")
            db.executemany("INSERT INTO recitation_track VALUES (?,?)", [(1, "needs_review"), (2, "ready")])
        self.review = ReviewDatabase(self.root / "review.sqlite")
        self.snapshot = self.root / "queue-snapshot.json"
        write_json(self.snapshot, {"version": 1, "publicationStatus": "held",
                                  "canonicalPath": str(self.canonical), "cases": [],
                                  "queueSha256": digest_json([]), "archivedQueues": []})
        self.config = {"version": 1, "stateDirectory": str(self.root / "workflow"),
                       "actionStore": str(self.root / "actions.sqlite"), "publicationDatabase": str(self.publication),
                       "reviewStore": str(self.review.path), "canonicalPath": str(self.canonical),
                       "planPath": str(self.plan), "jobRoot": str(self.root / "completed-diagnostics"),
                       "recordings": str(self.root), "batchRoot": str(self.root / "batches"),
                       "queueSnapshot": str(self.snapshot), "reviewUrl": "http://127.0.0.1:8792/",
                       "planSha256": digest_file(self.plan), "publicationSha256": digest_file(self.publication)}
        self.loader = patch("listening_queue.load_queue", side_effect=read_json)
        self.loader.start()
        self.addCleanup(self.loader.stop)
        self.diagnostic = patch("listening_accept.verify_diagnostic")
        self.diagnostic.start()
        self.addCleanup(self.diagnostic.stop)
        self.importer = Mock(side_effect=self.import_results)
        self.seeder = Mock()
        self.builder, self.writer = Mock(), Mock(side_effect=self.write_context)
        self.extra_feedback = {"typedCustomField": {"empty": "", "values": [1, 1, None]}}

    def fetch(self, suffix):
        if suffix == "/api/preparation-workload":
            return self.review.preparation_workload()
        self.assertEqual(suffix, "/api/export")
        return {"version": 1, **self.review.export_feedback(), "actionResponses": self.workflow.actions.responses(),
                "publicationStatus": "held", **deepcopy(self.extra_feedback)}

    def case(self, verse=1):
        folder = self.root / ("case-" + str(verse))
        folder.mkdir(exist_ok=True)
        diagnostic = folder / "diagnostic.json"
        write_json(diagnostic, {"fixture": "immutable acoustic evidence", "pasuk": verse})
        clip = folder / "clip.wav"
        with wave.open(str(clip), "wb") as stream:
            stream.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            stream.writeframes(bytes([8, 1]) * 32000)
        row = {"id": f"1-{verse}", "perekId": 1, "pasuk": verse, "label": "בראשית א " + ("א" if verse == 1 else "ב"),
               "audioSha256": digest_file(self.audio), "textSha256": "a" * 64,
               "audioPath": str(self.audio), "manifestPath": str(folder / "manifest.json"),
               "diagnosticPath": str(diagnostic), "diagnosticSha256": digest_file(diagnostic),
               "clipStartMs": 0, "clipEndMs": 2000, "clipPath": str(clip), "clipSha256": digest_file(clip),
               "words": [{"pasuk": verse, "segment": 1, "text": "בראשית",
                          "startMs": 100 if verse == 1 else 1100, "endMs": 500 if verse == 1 else 1500,
                          "acousticScore": 1.0}], "publicationStatus": "held"}
        row["candidateSha256"] = candidate_digest(row)
        return row

    def packet(self, cases, name="prepared-packet"):
        folder = self.root / name
        folder.mkdir(exist_ok=True)
        path = folder / "queue.json"
        write_json(path, {"version": 1, "publicationStatus": "held", "canonicalPath": str(self.canonical),
                          "cases": cases, "queueSha256": digest_json(cases), "archivedQueues": []})
        return path

    def task(self, case, kind="review-cuts"):
        task = {"version": 1, "policy": ACTION_POLICY, "taskId": "concern-" + case["id"], "kind": kind,
                "perekId": case["perekId"], "pasuk": case["pasuk"], "label": case["label"],
                "sourceAudioPath": str(self.audio), "audioSha256": case["audioSha256"], "textSha256": case["textSha256"],
                "sourceFrames": 32000, "sourceSampleRate": 16000, "sourcePcmSha256": "b" * 64,
                "canonicalWords": [{"pasuk": case["pasuk"], "segment": 1, "text": "בראשית"}],
                "sourceEvidence": {"manifestPath": case["manifestPath"], "manifestSha256": "c" * 64,
                                   "canonicalPath": str(self.canonical), "canonicalSha256": digest_file(self.canonical),
                                   **getattr(self, "source_evidence_extra", {})}}
        if kind == "review-cuts":
            task["caseRef"] = {key: case[key] for key in ("candidateSha256", "clipSha256")}
            task["caseRef"]["caseId"] = case["id"]
        task["taskSha256"] = task_digest(task)
        return task

    def make_workflow(self, cases, kind="review-cuts"):
        packet = self.packet(cases)
        tasks = [self.task(case, kind) for case in cases]
        self.seeder.return_value = {"tasks": tasks, "queues": [packet] if kind == "review-cuts" else []}
        self.workflow = ConcernWorkflow(self.config, fetch=self.fetch, seeder=self.seeder,
                                       context_builder=self.builder, context_writer=self.writer,
                                       importer=self.importer)
        self.workflow.seed()
        return self.workflow

    def answer(self, case, verdict="good", suffix="01"):
        payload = {"submissionId": "actual-browser-review-" + case["id"] + "-" + suffix,
                   "caseId": case["id"], "candidateSha256": case["candidateSha256"],
                   "clipSha256": case["clipSha256"], "verdict": verdict, "heardSegments": [1],
                   "heardEditedSegments": [], "timingEdits": [], "note": "actual problem note" if verdict == "problem" else ""}
        row = self.review.save_word_review(payload)
        if verdict == "good":
            verify_word_review(case, row, row["queueSha256"])
        return row

    def locate(self, task):
        return self.workflow.actions.save_response({
            "submissionId": "actual-browser-location-" + str(task["pasuk"]), "taskId": task["taskId"],
            "taskSha256": task["taskSha256"], "kind": "locate-source-range", "audioSha256": task["audioSha256"],
            "textSha256": task["textSha256"], "startMs": 0, "endMs": 2000,
            "heardRange": {"startMs": 0, "endMs": 2000, "complete": True}, "note": ""})

    def write_context(self, _study, _folder, _label):
        return self.packet([self.context_case], "context-packet")

    def import_results(self, queue_path, reviews_path, canonical, output, preview):
        self.assertEqual(canonical, self.canonical)
        feedback = read_json(reviews_path)
        self.assertEqual(feedback, self.fetch("/api/export"))
        archives = read_json(queue_path)["archivedQueues"]
        self.assertTrue(archives)
        for packet in archives:
            self.assertEqual(digest_file(Path(packet["path"])), packet["sha256"])
        latest = feedback["wordReviews"][-1]
        verdict = latest["verdict"]
        with closing(sqlite3.connect(preview)) as db, db:
            db.execute("UPDATE recitation_track SET alignment_status=? WHERE perek_id=1",
                       ("ready" if verdict == "good" else "needs_review",))
        return {"accepted": [1] if verdict == "good" else [], "updatedReviews": [],
                "withdrawn": [] if verdict == "good" else [1], "held": [], "alreadyAccepted": [], "words": 1}

    def test_seed_resumes_exact_current_mirror_without_inference_or_human_input(self):
        source = self.publication.read_bytes()
        case = self.case()
        workflow = self.make_workflow([case])
        self.assertEqual(workflow.result.read_bytes(), source)
        self.assertEqual(self.publication.read_bytes(), source)
        workflow._process_contexts()
        workflow.refresh()
        self.builder.assert_not_called()
        self.writer.assert_not_called()
        self.importer.assert_not_called()
        self.assertEqual(workflow.actions.responses(), [])
        self.assertEqual(workflow.actions.tasks()[0]["state"], "review")

    def test_complete_real_good_invokes_guarded_import_once_and_changes_only_private_mirror(self):
        case = self.case()
        workflow = self.make_workflow([case])
        original = self.publication.read_bytes()
        decision = self.answer(case)
        workflow.refresh()
        self.assertEqual(self.importer.call_count, 1)
        self.assertEqual(workflow.actions.tasks()[0]["state"], "resolved")
        self.assertEqual(workflow.actions.outcome_for("concern-1-1")["details"]["reviewSha256"], digest_json(decision))
        self.assertEqual(self.publication.read_bytes(), original)
        self.assertNotEqual(workflow.result.read_bytes(), original)
        before_events = workflow.actions.outcomes()
        workflow.refresh()
        self.assertEqual(workflow.actions.outcomes(), before_events)
        self.assertEqual(self.importer.call_count, 1)

    def test_any_pending_or_problem_or_skip_keeps_chapter_incomplete_and_actionable(self):
        first, second = self.case(1), self.case(2)
        workflow = self.make_workflow([first, second])
        self.answer(first)
        workflow.refresh()
        self.importer.assert_not_called()
        self.assertEqual(workflow.status["chapters"][0]["remainingActions"], 1)
        for index, verdict in enumerate(("problem", "skip"), 2):
            self.answer(second, verdict, str(index))
            workflow.refresh()
            self.importer.assert_not_called()
            self.assertEqual(workflow.actions.tasks()[1]["state"], "review")
        self.answer(second, "good", "last")
        workflow.refresh()
        self.assertEqual(self.importer.call_count, 1)
        self.assertTrue(all(task["state"] == "resolved" for task in workflow.actions.tasks()))

    def test_actual_context_response_prepares_review_but_never_approves_the_selected_range(self):
        self.context_case = self.case()
        workflow = self.make_workflow([self.context_case], "locate-source-range")
        workflow._process_contexts()
        self.builder.assert_not_called()
        task = workflow.actions.tasks(private=True)[0]
        response = self.locate(task)
        workflow._process_contexts()
        self.builder.assert_called_once_with(task, response)
        self.writer.assert_called_once()
        self.importer.assert_not_called()
        self.assertEqual(workflow.actions.tasks()[0]["state"], "review")
        self.assertEqual(workflow.actions.responses(), [response])
        workflow._process_contexts()
        self.assertEqual(self.builder.call_count, 1)
        workflow.refresh()
        self.importer.assert_not_called()
        self.answer(self.context_case)
        workflow.refresh()
        self.assertEqual(workflow.actions.tasks()[0]["state"], "resolved")

    def test_new_real_source_selection_supersedes_inflight_alignment_before_any_append(self):
        case = self.case()
        workflow = self.make_workflow([case], "locate-source-range")
        task = workflow.actions.tasks(private=True)[0]
        first = self.locate(task)
        later = []

        def align(_task, response):
            if response["submissionId"] == first["submissionId"]:
                later.append(workflow.actions.save_response({
                    "submissionId": "actual-newer-source-selection", "taskId": task["taskId"],
                    "taskSha256": task["taskSha256"], "kind": "locate-source-range",
                    "audioSha256": task["audioSha256"], "textSha256": task["textSha256"],
                    "startMs": 100, "endMs": 1900,
                    "heardRange": {"startMs": 100, "endMs": 1900, "complete": True}, "note": ""}))
            return {"actualResponseSha256": response["responseSha256"]}

        def write(study, folder, _label):
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / "queue.json"
            write_json(path, {"version": 1, "publicationStatus": "held", "canonicalPath": str(self.canonical),
                              "cases": [case], "queueSha256": digest_json([case]), "archivedQueues": [],
                              "sourceSelectionSha256": study["actualResponseSha256"]})
            return path

        self.builder.side_effect = align
        self.writer.side_effect = write
        workflow._process_contexts()
        self.assertEqual(len(later), 1)
        self.assertEqual(self.review.preparation_workload()["offeredCaseIds"], [])
        first_events = [row for row in workflow.actions.outcomes() if row["submissionId"] == first["submissionId"]]
        self.assertEqual(first_events[-1]["state"], "pending")
        self.assertEqual(first_events[-1]["details"]["reasonCode"], "superseded_source_selection")
        self.assertEqual(workflow.actions.responses(), [first, later[0]])
        workflow._process_contexts()
        self.assertEqual(self.builder.call_count, 2)
        self.assertEqual(self.builder.call_args.args, (task, later[0]))
        self.assertEqual(self.review.preparation_workload()["offeredCaseIds"], [case["id"]])
        self.assertEqual(len(workflow.ledger["packets"]), 1)
        offered = read_json(Path(workflow.ledger["packets"][0]["path"]))
        self.assertEqual(offered["sourceSelectionSha256"], later[0]["responseSha256"])
        self.assertEqual(workflow.actions.tasks()[0]["state"], "review")
        self.assertEqual(self.review.export_feedback()["wordReviews"], [])
        workflow._process_contexts()
        self.assertEqual(self.builder.call_count, 2)

    def test_new_range_on_chapter_review_rebinds_all_same_verse_tasks_and_requires_fresh_good(self):
        case = self.case()
        old_clip = self.root / "original-narrow-context.wav"
        with wave.open(str(old_clip), "wb") as stream:
            stream.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            stream.writeframes(bytes([8, 1]) * 16000)
        case.update(clipPath=str(old_clip), clipSha256=digest_file(old_clip), clipStartMs=500, clipEndMs=1500,
                    words=[{**case["words"][0], "startMs": 600, "endMs": 900}])
        case["candidateSha256"] = candidate_digest(case)
        workflow = self.make_workflow([case])
        old_good = self.answer(case)
        base_task = workflow.actions.tasks(private=True)[0]
        followup = {**base_task, "taskId": "chapter-check-1-1-range",
                    "chapterConcern": {"validationSha256": "e" * 64, "previousReviewSha256": digest_json(old_good),
                                       "reasonCode": "chapter_validation_failure", "segments": [1]}}
        followup["taskSha256"] = task_digest(followup)
        workflow.actions.seed([followup])
        new_clip = self.root / "broader-source-context.wav"
        with wave.open(str(new_clip), "wb") as stream:
            stream.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            stream.writeframes(bytes([8, 1]) * 32000)
        self.context_case = {**case, "clipPath": str(new_clip), "clipSha256": digest_file(new_clip),
                             "clipStartMs": 0, "clipEndMs": 2000}
        self.context_case["candidateSha256"] = candidate_digest(self.context_case)
        selected = self.locate(followup)
        workflow._process_contexts()
        self.builder.assert_called_once_with(followup, selected)
        workflow.refresh()
        self.importer.assert_not_called()
        fresh_ref = {"caseId": self.context_case["id"], "candidateSha256": self.context_case["candidateSha256"],
                     "clipSha256": self.context_case["clipSha256"]}
        public = workflow.actions.tasks()
        self.assertEqual(len(public), 2)
        self.assertTrue(all(task["caseRef"] == fresh_ref for task in public))
        self.assertTrue(all(task["state"] == "review" for task in public))
        self.assertNotIn("chapterConcern", public[1])
        self.assertEqual(workflow.actions.task(base_task["taskId"]), base_task)
        self.assertEqual(workflow.actions.task(followup["taskId"]), followup)
        self.assertEqual(self.review.case(case["id"], case["candidateSha256"], case["clipSha256"]), case)
        new_good = self.answer(self.context_case, suffix="fresh-new-context")
        workflow.refresh()
        self.assertEqual(self.importer.call_count, 1)
        self.assertTrue(all(task["state"] == "resolved" for task in workflow.actions.tasks()))
        self.assertEqual(self.review.export_feedback()["wordReviews"], [old_good, new_good])

    def test_same_verse_source_hold_is_never_rebound_to_a_new_timing_candidate(self):
        case = self.case()
        workflow = self.make_workflow([case])
        base = workflow.actions.tasks(private=True)[0]
        source = {key: value for key, value in base.items() if key not in ("taskSha256", "caseRef")}
        source.update(taskId="source-concern-1-1", kind="source-remediation")
        source["taskSha256"] = task_digest(source)
        workflow.actions.seed([source])
        fresh = {**case, "candidateSha256": "f" * 64}
        public = {task["taskId"]: task for task in workflow.actions.tasks()}
        self.assertTrue(workflow._link_current_candidates(workflow.actions.tasks(private=True), public, {fresh["id"]: fresh}))
        source_public = next(task for task in workflow.actions.tasks() if task["taskId"] == source["taskId"])
        self.assertEqual(source_public["state"], "needs_source")
        self.assertNotIn("caseRef", source_public)
        self.assertIsNone(workflow.actions.outcome_for(source["taskId"]))
        self.assertEqual(workflow.actions.responses(), [])

    def test_context_failure_keeps_a_concrete_location_action_and_no_review_or_ready_claim(self):
        case = self.case()
        workflow = self.make_workflow([case], "locate-source-range")
        self.locate(workflow.actions.tasks(private=True)[0])
        self.builder.side_effect = ValueError("private diagnostic source mismatch")
        workflow._process_contexts()
        self.assertEqual(workflow.actions.tasks()[0]["state"], "pending")
        self.assertNotIn("private", str(workflow.actions.public_view()))
        self.importer.assert_not_called()
        workflow._process_contexts()
        self.assertEqual(self.builder.call_count, 1)

    def test_later_problem_withdraws_local_approval_and_reopens_review_action(self):
        case = self.case()
        workflow = self.make_workflow([case])
        self.answer(case)
        workflow.refresh()
        self.answer(case, "problem", "later")
        workflow.refresh()
        self.assertEqual(self.importer.call_count, 2)
        self.assertEqual(workflow.actions.tasks()[0]["state"], "review")
        self.assertEqual(workflow._ready()[1], {2})

    def test_importer_failure_keeps_local_chapter_unready_and_all_actual_reviews_intact(self):
        case = self.case()
        workflow = self.make_workflow([case])
        decision = self.answer(case)
        before = workflow.result.read_bytes()
        self.importer.side_effect = ValueError("complete chapter geometry still invalid")
        with self.assertRaisesRegex(ValueError, "chapter geometry"):
            workflow.refresh()
        self.assertEqual(workflow.result.read_bytes(), before)
        self.assertEqual(workflow._ready()[1], {2})
        self.assertEqual(workflow.actions.tasks()[0]["state"], "review")
        self.assertEqual(self.review.export_feedback()["wordReviews"], [decision])
        self.assertIsNone(workflow.ledger["validation"])

    def test_transient_import_failure_retries_same_genuine_feedback_without_adopting_partial_result(self):
        case = self.case()
        workflow = self.make_workflow([case])
        genuine_good = self.answer(case)
        before = workflow.result.read_bytes()
        attempts = []

        def import_with_transient_failure(*arguments):
            attempts.append(arguments)
            if len(attempts) == 1:
                with closing(sqlite3.connect(arguments[-1])) as preview, preview:
                    preview.execute("UPDATE recitation_track SET alignment_status='ready' WHERE perek_id=1")
                raise OSError("transient local result copy failure")
            self.assertEqual(Path(arguments[-1]).read_bytes(), before)
            return self.import_results(*arguments)

        self.importer.side_effect = import_with_transient_failure
        with self.assertRaisesRegex(OSError, "transient"):
            workflow.refresh()
        self.assertEqual(workflow.result.read_bytes(), before)
        self.assertEqual(workflow._ready()[1], {2})
        self.assertEqual(self.review.export_feedback()["wordReviews"], [genuine_good])
        self.assertIsNone(workflow.ledger["feedbackAttemptSha256"])
        workflow.refresh()
        self.assertEqual(len(attempts), 2)
        self.assertEqual(workflow._ready()[1], {1, 2})
        self.assertEqual(self.review.export_feedback()["wordReviews"], [genuine_good])
        self.assertEqual(workflow.actions.responses(), [])
        workflow.refresh()
        self.assertEqual(len(attempts), 2)

    def test_source_remediation_feedback_cannot_approve_an_original_recording(self):
        case = self.case()
        workflow = self.make_workflow([case], "source-remediation")
        task = workflow.actions.tasks(private=True)[0]
        response = workflow.actions.save_response({
            "submissionId": "actual-source-problem-feedback", "taskId": task["taskId"],
            "taskSha256": task["taskSha256"], "kind": "source-remediation",
            "audioSha256": task["audioSha256"], "textSha256": task["textSha256"],
            "decision": "request_corrected_source", "note": "actual missing original clause"})
        workflow._process_contexts()
        workflow.refresh()
        self.builder.assert_not_called()
        self.importer.assert_not_called()
        self.assertEqual(workflow.actions.responses(), [response])
        self.assertEqual(workflow.actions.tasks()[0]["state"], "needs_source")
        self.assertEqual(workflow._ready()[1], {2})

    def test_model_failure_stays_pending_without_a_reduced_quality_fallback(self):
        case = self.case()
        workflow = self.make_workflow([case], "locate-source-range")
        self.locate(workflow.actions.tasks(private=True)[0])
        self.builder.side_effect = RuntimeError("original CUDA execution failed")
        workflow._process_contexts()
        self.builder.assert_called_once()
        self.writer.assert_not_called()
        self.assertEqual(workflow.actions.tasks()[0]["state"], "pending")

    def test_validated_result_resume_is_bound_to_its_own_actual_hash(self):
        case = self.case()
        workflow = self.make_workflow([case])
        self.answer(case)
        workflow.refresh()
        resumed = ConcernWorkflow(self.config, fetch=self.fetch, importer=self.importer)
        self.assertEqual(resumed._ready()[1], {1, 2})
        self.assertEqual(resumed.ledger["resultSha256"], digest_file(resumed.result))
        with resumed.result.open("ab") as stream:
            stream.write(b"unbound mutation")
        with self.assertRaisesRegex(ValueError, "result"):
            ConcernWorkflow(self.config, fetch=self.fetch, importer=self.importer)

    def test_later_genuine_source_report_suspends_private_readiness_without_faking_problem_review(self):
        case = self.case()
        workflow = self.make_workflow([case])
        original = self.publication.read_bytes()
        genuine_good = self.answer(case)
        workflow.refresh()
        self.assertEqual(workflow._ready()[1], {1, 2})
        task = workflow.actions.tasks(private=True)[0]
        report = workflow.actions.save_response({
            "submissionId": "actual-later-source-problem", "taskId": task["taskId"],
            "taskSha256": task["taskSha256"], "kind": "source-remediation",
            "audioSha256": task["audioSha256"], "textSha256": task["textSha256"],
            "decision": "source_problem", "note": "actual missing original clause"})
        workflow.refresh()
        self.assertEqual(workflow._ready()[1], {2})
        self.assertEqual(workflow.actions.tasks()[0]["state"], "needs_source")
        self.assertEqual(workflow.status["chapters"][0]["remainingActions"], 1)
        self.assertEqual(self.review.export_feedback()["wordReviews"], [genuine_good])
        self.assertEqual(workflow.actions.responses(), [report])
        self.assertEqual(self.publication.read_bytes(), original)
        self.assertEqual(self.importer.call_count, 1)
        before = workflow.result.read_bytes()
        workflow.refresh()
        self.assertEqual(workflow.result.read_bytes(), before)
        self.assertEqual(self.importer.call_count, 1)

    def test_all_good_but_cross_verse_overlap_creates_new_bound_actions_not_silent_completion(self):
        first, second = self.case(1), self.case(2)
        manifest = self.root / "full-chapter-manifest.json"
        write_json(manifest, {"words": [first["words"][0], second["words"][0]]})
        self.source_evidence_extra = {"manifestPath": str(manifest), "manifestSha256": digest_file(manifest),
                                      "canonicalPath": str(self.canonical), "canonicalSha256": digest_file(self.canonical)}
        workflow = self.make_workflow([first, second])
        first_good = self.review.save_word_review({
            "submissionId": "actual-browser-overlap-review", "caseId": first["id"],
            "candidateSha256": first["candidateSha256"], "clipSha256": first["clipSha256"],
            "verdict": "good", "heardSegments": [], "heardEditedSegments": [1],
            "timingEdits": [{"segment": 1, "startMs": 100, "endMs": 1200}], "note": ""})
        second_good = self.answer(second)
        held = {"accepted": [], "updatedReviews": [], "withdrawn": [], "alreadyAccepted": [], "words": 0,
                "held": [{"perekId": 1, "reason": "Word timings overlap between adjacent verses"}]}
        self.importer.side_effect = lambda *_arguments: deepcopy(held)
        with patch("listening_machine.canonical_words",
                   return_value=[Word(1, 1, "בראשית"), Word(2, 1, "בראשית")]):
            workflow.refresh()
        self.assertEqual(workflow._ready()[1], {2})
        followups = [task for task in workflow.actions.tasks(private=True) if task.get("chapterConcern")]
        self.assertEqual(len(followups), 2)
        previous = {1: digest_json(first_good), 2: digest_json(second_good)}
        for task in followups:
            self.assertEqual(task["chapterConcern"], {
                "validationSha256": digest_json(held), "previousReviewSha256": previous[task["pasuk"]],
                "reasonCode": "cross_verse_overlap", "segments": [1]})
        self.assertEqual(self.review.export_feedback()["wordReviews"], [first_good, second_good])
        self.assertEqual(workflow.actions.responses(), [])
        workflow.refresh()
        self.assertEqual(self.importer.call_count, 1)
        public = workflow.actions.public_view()["tasks"]
        self.assertTrue(all(task["state"] == "review" for task in public if task.get("chapterConcern")))

    def test_closed_evidence_preserves_every_actual_feedback_field_and_exact_packet_bytes(self):
        case = self.case()
        workflow = self.make_workflow([case])
        self.answer(case, "problem")
        self.answer(case, "good", "later")
        feedback = self.fetch("/api/export")
        folder = workflow._evidence(feedback)
        self.assertEqual(read_json(folder / "reviews.json"), feedback)
        queue = read_json(folder / "queue.json")
        original_packets = workflow._packet_sources()
        for copied, original in zip(queue["archivedQueues"], original_packets):
            self.assertEqual(Path(copied["path"]).read_bytes(), Path(original["path"]).read_bytes())
        self.assertEqual(self.review.export_feedback()["wordReviews"], feedback["wordReviews"])

    def test_constructor_rejects_changed_baseline_and_overlapping_or_remote_paths(self):
        for change in ({"publicationSha256": "0" * 64}, {"actionStore": self.config["reviewStore"]},
                       {"reviewUrl": "http://remote.invalid/"}, {"pollSeconds": True},
                       {"stateDirectory": self.config["jobRoot"]}, {"queueSnapshot": "relative.json"},
                       {"publicationDatabase": str(self.root / "recitation-working.sqlite")}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                ConcernWorkflow({**self.config, **change}, fetch=self.fetch, seeder=self.seeder, importer=self.importer)

    def test_changed_plan_and_unbound_existing_result_mirror_fail_closed(self):
        write_json(self.plan, {"changed": True})
        with self.assertRaisesRegex(ValueError, "plan changed"):
            ConcernWorkflow(self.config)
        write_json(self.plan, {"targets": []})
        result = Path(self.config["stateDirectory"]) / "results" / "recitation.sqlite"
        result.parent.mkdir(parents=True, exist_ok=True)
        result.write_bytes(b"stale unbound result")
        with self.assertRaises(ValueError):
            ConcernWorkflow(self.config)

    def test_later_problem_reopens_a_resolved_human_location_task_for_cut_review(self):
        self.context_case = self.case()
        workflow = self.make_workflow([self.context_case], "locate-source-range")
        self.locate(workflow.actions.tasks(private=True)[0])
        workflow._process_contexts()
        self.answer(self.context_case)
        workflow.refresh()
        self.assertEqual(workflow.actions.tasks()[0]["state"], "resolved")
        self.answer(self.context_case, "problem", "later")
        workflow.refresh()
        self.assertEqual(workflow.actions.tasks()[0]["state"], "review")


if __name__ == "__main__":
    unittest.main()
