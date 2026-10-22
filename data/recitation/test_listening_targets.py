"""Every pending chapter has a real action, without rewriting earlier approvals."""

from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import wave

from listening_actions import ActionDatabase
from alignment import load_chapters, text_hash, words_for
from listening_review import digest_file, digest_json, read_json, write_json
from listening_targets import _pcm_clip, prepare_concerns
import test_listening_context as context_fixtures


class ConcernTargetsTests(unittest.TestCase):
    def setUp(self):
        # Reuse the exact source/canonical/ASR fixture, never a live review store.
        fixture = context_fixtures.ContextTests("test_source_edges_use_null_adjacent_anchors_without_fake_bounds")
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.fixture = fixture
        self.root = fixture.root
        self.plan_path = self.root / "plan.json"
        self.plan = {"targets": [{"perekId": 1, "pasuk": 1,
            "reason": "insufficient ASR agreement", "rawDiagnostic": None,
            "contextHoldReason": "Source-edge context remains held", "knownSourceDefectHold": False}]}
        write_json(self.plan_path, self.plan)
        self.config = {"planPath": str(self.plan_path), "planSha256": digest_file(self.plan_path),
            "jobRoot": str(self.root), "canonicalPath": str(fixture.canonical),
            "recordings": str(self.root), "batchRoot": str(self.root / "batches"),
            "stateDirectory": str(self.root / "state"), "sourceFallback": str(fixture.source),
            "pendingIds": [1], "knownSourceIssues": {}}
        self.decoder = Mock(return_value=fixture.pcm)
        self.duration = patch("listening_targets.duration", return_value=2000)
        self.duration.start()
        self.addCleanup(self.duration.stop)

    def prepare(self, ready=(), offered=(), cases=None):
        return prepare_concerns(self.config, set(ready), set(offered), cases or {}, decoder=self.decoder)

    def test_context_hold_is_an_unapproved_action_with_complete_source_playback(self):
        result = self.prepare()
        task = result["tasks"][0]
        self.assertEqual(task["kind"], "locate-source-range")
        self.assertEqual(task["canonicalWords"], self.fixture.task["canonicalWords"])
        self.assertEqual(task["sourceFrames"], 32000)
        self.assertFalse(task["automaticApproval"])
        self.assertEqual(task["publicationStatus"], "held")
        self.assertNotIn("startMs", task)
        self.assertNotIn("endMs", task)
        playback = Path(task["sourcePlaybackPath"])
        self.assertEqual(playback.read_bytes()[44:], self.fixture.pcm)
        self.assertEqual(digest_file(playback), task["playbackSha256"])
        self.assertEqual(task["taskSha256"], digest_json({key: value for key, value in task.items()
                                                         if key != "taskSha256"}))
        self.assertEqual(result["chapters"][0]["expectedTargets"], 1)
        self.assertEqual(result["queues"], [])
        self.decoder.assert_called_once_with(self.fixture.audio)

    def test_seeded_definition_and_float_source_playback_pass_the_actual_action_store(self):
        result = self.prepare()
        actions = ActionDatabase(self.root / "actions.sqlite")
        self.assertEqual(actions.seed(result["tasks"]), 1)
        self.assertEqual(actions.tasks(private=True), result["tasks"])
        self.assertEqual(actions.seed(result["tasks"]), 0)

    def test_clip_conversion_uses_only_exact_cached_source_frames_and_keeps_sample_count(self):
        path = self.root / "cut.wav"
        pcm = bytes(range(256)) * 32
        expected = pcm[64:128]
        result = SimpleNamespace(stdout=b"\0" * 64, stderr=b"")
        with patch("listening_targets.executable", return_value="ffmpeg"), \
                patch("listening_targets.subprocess.run", return_value=result) as convert:
            _pcm_clip(pcm, path, 1, 2)
        self.assertEqual(convert.call_args.kwargs["input"], expected)
        with wave.open(str(path), "rb") as clip:
            self.assertEqual(clip.getnframes(), 16)
            self.assertEqual(clip.getsampwidth(), 4)
            self.assertEqual(clip.readframes(16), b"\0" * 64)

    def test_completed_catalog_resumes_identically_without_redecoding_or_new_packets(self):
        first = self.prepare()
        second = self.prepare()
        self.assertEqual(first, second)
        self.assertEqual(self.decoder.call_count, 1)

    def test_existing_good_or_reported_candidate_keeps_its_exact_immutable_reference(self):
        case = self.fixture.case(self.fixture.build())
        before = deepcopy(case)
        result = self.prepare(offered=["1-1"], cases={"1-1": case})
        task = result["tasks"][0]
        self.assertEqual(task["kind"], "review-cuts")
        self.assertEqual(task["caseRef"], {"caseId": "1-1", "candidateSha256": "candidate",
                                           "clipSha256": "clip"})
        self.assertEqual(case, before)
        self.assertEqual(result["queues"], [])

    def test_original_source_defect_is_remediation_and_cannot_be_a_cut_good(self):
        self.config["knownSourceIssues"] = {1: 2223}
        self.config["knownSourceIssueVerses"] = {1: [1]}
        task = self.prepare()["tasks"][0]
        self.assertEqual(task["kind"], "source-remediation")
        self.assertEqual(task["issueUrl"], "https://github.com/bible-on-site/bible-on-site/issues/2223")
        self.assertNotIn("caseRef", task)
        self.assertFalse(task["automaticApproval"])

    def test_source_issue_is_scoped_to_its_exact_verse_without_reclassifying_siblings(self):
        self.config["knownSourceIssues"] = {1: 2223}
        self.config["knownSourceIssueVerses"] = {1: [1]}
        canonical = read_json(self.fixture.canonical)
        canonical[0]["perakim"][0]["pesukim"].append({"segments": [{"type": "qri", "value": "אור"}]})
        write_json(self.fixture.canonical, canonical)
        manifest = self.fixture.manifest
        manifest["words"].append({"pasuk": 2, "segment": 1, "text": "אור", "startMs": None,
                                   "endMs": None, "textScore": 0., "acousticScore": .5})
        manifest["textSha256"] = text_hash(words_for(load_chapters(self.fixture.canonical)[1]))
        write_json(self.fixture.source / "alignments/1.json", manifest)
        report = deepcopy(self.fixture.report)
        report.update(words=deepcopy(manifest["words"]), textSha256=manifest["textSha256"], totalWords=3)
        report["review"].append({"pasuk": 2, "reason": "insufficient ASR agreement"})
        write_json(self.fixture.source / "1.review.json", report)
        result = self.prepare()
        self.assertEqual([(task["pasuk"], task["kind"]) for task in result["tasks"]],
                         [(1, "source-remediation"), (2, "locate-source-range")])
        self.assertNotIn("issueUrl", result["tasks"][1])

    def test_already_ready_chapter_is_not_reoffered_or_decoded(self):
        result = self.prepare(ready=[1])
        self.assertEqual(result, {"tasks": [], "queues": [], "chapters": []})
        self.decoder.assert_not_called()

    def test_previously_offered_case_cannot_be_silently_replaced_or_forgotten(self):
        with self.assertRaisesRegex(ValueError, "immutable current candidate"):
            self.prepare(offered=["1-1"])

    def test_supported_raw_sibling_can_be_reviewed_before_other_chapter_actions_finish(self):
        self.plan["targets"][0].update(rawDiagnostic={"path": "bound-raw", "sha256": "bound-sha"},
                                       contextHoldReason=None)
        write_json(self.plan_path, self.plan)
        self.config["planSha256"] = digest_file(self.plan_path)
        case = self.fixture.case(self.fixture.build())
        packet = self.root / "prepared-queue.json"
        write_json(packet, {"immutable": "queue"})
        binding = {"path": str(packet), "sha256": digest_file(packet)}
        with patch("listening_targets._candidate", return_value=(case, binding)) as candidate:
            result = self.prepare()
        candidate.assert_called_once()
        self.assertEqual(result["tasks"][0]["kind"], "review-cuts")
        self.assertEqual(result["queues"], [binding])
        self.assertEqual(self.decoder.call_count, 1)

    def test_failed_raw_geometry_becomes_a_source_location_action_without_fake_cuts(self):
        self.plan["targets"][0].update(rawDiagnostic={"path": "bound-raw", "sha256": "bound-sha"},
                                       contextHoldReason=None)
        write_json(self.plan_path, self.plan)
        self.config["planSha256"] = digest_file(self.plan_path)
        with patch("listening_targets._candidate", side_effect=ValueError("Word duration outside quality limits")):
            result = self.prepare()
        task = result["tasks"][0]
        self.assertEqual(task["kind"], "locate-source-range")
        self.assertIn("Word duration", task["preparationFailure"])
        self.assertNotIn("caseRef", task)
        self.assertEqual(result["queues"], [])

    def test_cached_catalog_rejects_source_playback_and_original_evidence_changes(self):
        first = self.prepare()
        playback = Path(first["tasks"][0]["sourcePlaybackPath"])
        original = playback.read_bytes()
        playback.write_bytes(original[:-1] + b"x")
        with self.assertRaisesRegex(ValueError, "playback changed"):
            self.prepare()
        playback.write_bytes(original)
        report = self.fixture.source / "1.review.json"
        value = read_json(report)
        value["extra"] = "changed original report bytes"
        write_json(report, value)
        with self.assertRaisesRegex(ValueError, "original evidence"):
            self.prepare()

    def test_pending_chapter_cannot_finish_with_an_empty_or_unexplained_inventory(self):
        self.plan["targets"] = []
        write_json(self.plan_path, self.plan)
        self.config["planSha256"] = digest_file(self.plan_path)
        report = self.fixture.source / "1.review.json"
        value = read_json(report)
        value["review"] = []
        manifest = self.fixture.manifest
        for row, start, end in zip(manifest["words"], (100, 500), (300, 800), strict=True):
            row.update(startMs=start, endMs=end, textScore=1.)
        write_json(self.fixture.source / "alignments/1.json", manifest)
        value["words"] = deepcopy(manifest["words"])
        write_json(report, value)
        with self.assertRaisesRegex(ValueError, "no explained actionable concern"):
            self.prepare()

    def test_unlisted_original_duration_or_missing_boundaries_are_also_actionable(self):
        self.plan["targets"] = []
        write_json(self.plan_path, self.plan)
        self.config["planSha256"] = digest_file(self.plan_path)
        report = self.fixture.source / "1.review.json"
        value = read_json(report)
        value["review"] = []
        write_json(report, value)
        result = self.prepare()
        self.assertEqual(result["chapters"][0]["expectedTargets"], 1)
        self.assertEqual(result["tasks"][0]["kind"], "locate-source-range")
        self.assertIn("duration limits", result["tasks"][0]["originalConcern"]["reason"])


if __name__ == "__main__":
    unittest.main()
