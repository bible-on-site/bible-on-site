"""Actual source-range responses never stand in for fresh word-cut approval."""

from copy import deepcopy
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from alignment import load_chapters, text_hash, words_for
from listening_accept import approve_chapter, verify_diagnostic
from listening_context import (CONTEXT_METHOD, TASK_FIELDS, build_context_study,
                               verify_context_proposals, write_context_queue)
from listening_review import digest_file, digest_json, validate_decision, write_json
from model_versions import ALIGN_MODEL, ALIGN_REVISION, ASR_MODEL, ASR_REVISION
from trusted import AUDIO_BASE, TRUSTED_PIPELINE


class ContextTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source"
        (self.source / "alignments").mkdir(parents=True)
        self.canonical = self.root / "canonical.json"
        write_json(self.canonical, [{"name": "בראשית", "perekFrom": 1, "perakim": [
            {"perekId": 1, "pesukim": [{"segments": [
                {"type": "qri", "value": "בראשית"},
                {"type": "note", "value": "not a spoken word"},
                {"type": "qri", "value": "ברא"}]}]}]}])
        self.words = words_for(load_chapters(self.canonical)[1])
        self.audio = self.root / "1_record.mp3"
        self.audio.write_bytes(b"immutable original MP3")
        self.manifest = {"version": 1, "perekId": 1, "alignmentStatus": "needs_review",
            "pipeline": TRUSTED_PIPELINE, "durationMs": 2000,
            "audioUrl": f"{AUDIO_BASE}/1_record.mp3", "audioSha256": digest_file(self.audio),
            "textSha256": text_hash(self.words), "words": [
                {"pasuk": word.pasuk, "segment": word.segment, "text": word.text,
                 "startMs": None, "endMs": None, "acousticScore": .9, "textScore": 0.}
                for word in self.words]}
        self.report = {key: deepcopy(self.manifest[key]) for key in
                       ("perekId", "audioSha256", "textSha256", "pipeline", "words")}
        self.report.update(totalWords=2, review=[{"pasuk": 1, "reason": "insufficient ASR agreement"}])
        self.asr = {"audioSha256": self.manifest["audioSha256"], "model": ASR_MODEL,
                    "revision": ASR_REVISION, "words": [
                        {"text": word.speech, "start": 0., "end": .1} for word in self.words]}
        sources = {"manifest": self.source / "alignments/1.json", "report": self.source / "1.review.json",
                   "asr": self.source / "1.asr.json", "canonical": self.canonical}
        for key, value in (("manifest", self.manifest), ("report", self.report), ("asr", self.asr)):
            write_json(sources[key], value)
        evidence = {key + suffix: str(path.resolve()) if suffix == "Path" else digest_file(path)
                    for key, path in sources.items() for suffix in ("Path", "Sha256")}
        self.pcm = b"\0" * (32000 * 4)
        self.task = {"taskId": "context-1-1", "kind": "locate-source-range", "perekId": 1,
            "pasuk": 1, "label": "בראשית א א", "sourceAudioPath": str(self.audio.resolve()),
            "audioSha256": self.manifest["audioSha256"], "textSha256": self.manifest["textSha256"],
            "sourceFrames": 32000, "sourceSampleRate": 16000,
            "sourcePcmSha256": hashlib.sha256(self.pcm).hexdigest(),
            "canonicalWords": [{"pasuk": word.pasuk, "segment": word.segment, "text": word.text}
                               for word in self.words], "sourceEvidence": evidence}
        self.task["taskSha256"] = digest_json(self.task)
        self.response = {"submissionId": "actual-browser-submission", "taskId": self.task["taskId"],
            "taskSha256": self.task["taskSha256"], "kind": "locate-source-range",
            "audioSha256": self.task["audioSha256"], "textSha256": self.task["textSha256"],
            "startMs": 0, "endMs": 2000,
            "heardRange": {"startMs": 0, "endMs": 2000, "complete": True},
            "savedAt": "2026-10-22T12:00:00Z", "publicationStatus": "held", "automaticApproval": False,
            "reviewMethod": "human-source-range-selection", "note": ""}
        self.bind_response()
        self.rows = [{"pasuk": 1, "segment": word.segment, "text": word.text,
                      "startMs": start, "endMs": end, "acousticScore": .8}
                     for word, start, end in zip(self.words, (100, 500), (300, 800), strict=True)]
        self.paths = [{"pasuk": 1, "segment": row["segment"], "letterStartMs": row["startMs"],
                       "letterEndMs": row["endMs"], "letterAcousticScore": .8} for row in self.rows]
        self.paths[0].update(separatorStartMs=350, separatorEndMs=400, followingWordStartMs=500)
        self.paths[1].update(precedingWordEndMs=300, precedingSeparatorStartMs=350,
                             precedingSeparatorEndMs=400)
        self.engine = Mock(device="cuda", dtype="float32", threads=2,
                           model=ALIGN_MODEL, revision=ALIGN_REVISION)
        self.engine.run.return_value = (self.rows, self.paths)
        self.duration = patch("listening_context.duration", return_value=2000)
        self.duration.start()
        self.addCleanup(self.duration.stop)
        self.decoder = patch("listening_context.decode_source", return_value=self.pcm)
        self.decoder.start()
        self.addCleanup(self.decoder.stop)

    def bind_response(self):
        self.response["responseSha256"] = digest_json({key: value for key, value in
            self.response.items() if key != "responseSha256"})

    def build(self):
        return build_context_study(self.task, self.response, engine=self.engine)

    def case(self, study):
        path = self.root / "study.json"
        write_json(path, study)
        return {"id": "1-1", "perekId": 1, "pasuk": 1, "audioSha256": self.task["audioSha256"],
                "textSha256": self.task["textSha256"], "words": study["cases"][0]["diagnosticCandidates"],
                "clipStartMs": 0, "clipEndMs": 2000, "candidateSha256": "candidate",
                "clipSha256": "clip", "diagnosticPath": str(path),
                "diagnosticSha256": digest_file(path), "reviewKind": "missing"}

    def test_source_edges_use_null_adjacent_anchors_without_fake_bounds(self):
        diagnostic = self.build()["cases"][0]
        self.assertEqual(diagnostic["boundaryMethod"], CONTEXT_METHOD)
        self.assertIsNone(diagnostic["pathEvidence"][0]["precedingWordEndMs"])
        self.assertIsNone(diagnostic["pathEvidence"][-1]["followingWordStartMs"])
        self.assertEqual(diagnostic["diagnosticCandidates"], self.rows)
        self.assertEqual(self.engine.run.call_count, 2)
        self.assertEqual(diagnostic["contextWordIdentities"], [{"pasuk": 1, "segment": 1},
                                                               {"pasuk": 1, "segment": 3}])
        verify_context_proposals(diagnostic)

    def test_genuinely_selected_long_verse_range_uses_actual_frames_without_old_context_cap(self):
        self.manifest["durationMs"] = 70000
        self.pcm = b"\0" * (70000 * 16 * 4)
        write_json(self.source / "alignments/1.json", self.manifest)
        self.task["sourceEvidence"]["manifestSha256"] = digest_file(self.source / "alignments/1.json")
        self.task.update(sourceFrames=70000 * 16, sourcePcmSha256=hashlib.sha256(self.pcm).hexdigest())
        self.task["taskSha256"] = digest_json({key: value for key, value in self.task.items()
                                              if key != "taskSha256"})
        self.response.update(taskSha256=self.task["taskSha256"], endMs=70000,
                             heardRange={"startMs": 0, "endMs": 70000, "complete": True})
        self.bind_response()
        with patch("listening_context.decode_source", return_value=self.pcm), \
                patch("listening_context.duration", return_value=70000):
            diagnostic = self.build()["cases"][0]
            verify_context_proposals(diagnostic)
        self.assertEqual(diagnostic["contextEndSec"], 70.)
        self.assertEqual(diagnostic["completeDecodedSourceFrames"], 70000 * 16)
        self.assertFalse(diagnostic["automaticApproval"])

    def test_context_selection_is_not_a_word_approval(self):
        study = self.build()
        diagnostic = study["cases"][0]
        self.assertFalse(diagnostic["automaticApproval"])
        self.assertFalse(diagnostic["sourceInspectionPerformed"])
        self.assertTrue(diagnostic["requiresGenuineFreshCutHearing"])
        case = self.case(study)
        verify_diagnostic(case)
        with self.assertRaises(ValueError):
            approve_chapter(self.manifest, self.report, self.asr, self.words, self.audio,
                            2000, [case], {}, "queue")
        with self.assertRaises(ValueError):
            validate_decision(case, {"candidateSha256": "candidate", "verdict": "good",
                                     "heardSegments": [1], "note": ""})
        decision = validate_decision(case, {"candidateSha256": "candidate", "verdict": "good",
                                            "heardSegments": [1, 3], "note": ""})
        decision["queueSha256"] = "queue"
        accepted = approve_chapter(self.manifest, self.report, self.asr, self.words, self.audio,
                                  2000, [case], {"1-1": decision}, "queue")
        self.assertEqual(accepted["alignmentStatus"], "ready")

    def test_genuine_new_source_selection_can_recover_a_wrong_existing_cut_context(self):
        self.task.update(kind="review-cuts", version=1, policy="source-bound-human-action-v1",
                         caseRef={"caseId": "1-1", "candidateSha256": "a" * 64, "clipSha256": "b" * 64})
        self.task["taskSha256"] = digest_json({key: value for key, value in self.task.items()
                                              if key != "taskSha256"})
        self.response["taskSha256"] = self.task["taskSha256"]
        self.bind_response()
        diagnostic = self.build()["cases"][0]
        verify_context_proposals(diagnostic)
        self.assertEqual(diagnostic["contextEvidence"]["task"]["kind"], "review-cuts")
        self.assertEqual(diagnostic["contextEvidence"]["response"]["kind"], "locate-source-range")
        self.assertFalse(diagnostic["automaticApproval"])
        self.assertTrue(diagnostic["requiresGenuineFreshCutHearing"])

    def test_known_source_remediation_cannot_trigger_context_inference(self):
        self.task["kind"] = "source-remediation"
        self.task["taskSha256"] = digest_json({key: value for key, value in self.task.items()
                                              if key != "taskSha256"})
        self.response["taskSha256"] = self.task["taskSha256"]
        self.bind_response()
        with self.assertRaises(ValueError):
            self.build()
        self.engine.run.assert_not_called()

    def test_invalid_or_unheard_response_never_loads_or_runs_the_engine(self):
        for change in ({"taskSha256": "stale"}, {"publicationStatus": "ready"},
                       {"automaticApproval": True}, {"savedAt": "2026-10-22T12:00:00"},
                       {"heardRange": {"startMs": 0, "endMs": 2000, "complete": False}},
                       {"startMs": True}, {"endMs": 2001}):
            with self.subTest(change=change):
                original = deepcopy(self.response)
                self.response.update(change)
                self.bind_response()
                with patch("listening_context._engine") as factory:
                    with self.assertRaises(ValueError):
                        build_context_study(self.task, self.response)
                    factory.assert_not_called()
                self.response = original
        self.engine.run.assert_not_called()

    def test_source_task_canonical_pcm_and_immutable_files_cannot_drift(self):
        for mutate in (lambda: self.task.update(sourceFrames=31999),
                       lambda: self.task.update(sourcePcmSha256="wrong"),
                       lambda: self.task["canonicalWords"][0].update(segment=2),
                       lambda: self.task["sourceEvidence"].update(manifestSha256="wrong")):
            old = deepcopy(self.task)
            mutate()
            self.task["taskSha256"] = digest_json({key: self.task[key] for key in TASK_FIELDS})
            self.response["taskSha256"] = self.task["taskSha256"]
            self.bind_response()
            with self.assertRaises(ValueError):
                self.build()
            self.task = old
        self.engine.run.assert_not_called()

    def test_same_context_drift_cannot_make_a_candidate(self):
        changed = deepcopy(self.rows)
        changed[0]["endMs"] += 1
        self.engine.run.side_effect = [(self.rows, self.paths), (changed, self.paths)]
        with self.assertRaisesRegex(ValueError, "twice exactly"):
            self.build()

    def test_invalid_model_precision_or_device_never_falls_back(self):
        for key, value in (("device", "cpu"), ("dtype", "float16"), ("threads", 1),
                           ("revision", "different"), ("model", "different")):
            previous = getattr(self.engine, key)
            setattr(self.engine, key, value)
            with self.assertRaises(ValueError):
                self.build()
            setattr(self.engine, key, previous)
        self.engine.run.assert_not_called()

    def test_path_geometry_durations_scores_and_outer_anchors_are_not_fabricated(self):
        changes = (lambda rows, paths: rows[0].update(endMs=110),
                   lambda rows, paths: rows[1].update(startMs=290),
                   lambda rows, paths: paths[0].update(precedingWordEndMs=0),
                   lambda rows, paths: paths[1].update(followingWordStartMs=2000),
                   lambda rows, paths: paths[0].update(letterEndMs=301),
                   lambda rows, paths: rows[0].update(acousticScore=float("nan")),
                   lambda rows, paths: rows[0].update(segment=2),
                   lambda rows, paths: paths[0].update(separatorEndMs=501))
        for mutate in changes:
            rows, paths = deepcopy(self.rows), deepcopy(self.paths)
            mutate(rows, paths)
            self.engine.run.return_value = (rows, paths)
            with self.assertRaises(ValueError):
                self.build()

    def test_saved_response_raw_rows_and_replay_evidence_stay_exact(self):
        good = self.build()["cases"][0]
        for mutate in (lambda d: d.update(automaticApproval=True),
                       lambda d: d.update(sourceInspectionPerformed=True),
                       lambda d: d.update(sameContextReplayTwiceExactly=False),
                       lambda d: d["diagnosticCandidates"][0].update(endMs=301),
                       lambda d: d["contextEvidence"].update(selectedPcmSha256="different"),
                       lambda d: d["contextEvidence"]["response"].update(startMs=1),
                       lambda d: d["contextEvidence"].update(dtype="float16")):
            changed = deepcopy(good)
            mutate(changed)
            with self.assertRaises(ValueError):
                verify_context_proposals(changed)

    def test_initial_context_case_never_inherits_earlier_cut_hearing(self):
        study = self.build()
        for changes in ({"reviewKind": "reported"}, {"reusableHeardSegments": [1]},
                        {"listeningReusePath": "old"}, {"listeningReuseSha256": "old"}):
            case = self.case(study)
            case.update(changes)
            with self.assertRaises(ValueError):
                verify_diagnostic(case)

    def test_queue_packet_contains_original_pcm_clip_and_new_immutable_candidate(self):
        study = self.build()
        def clip(audio, target, start, end):
            self.assertEqual(audio, self.audio)
            self.assertEqual((start, end), (0, 2000))
            target.write_bytes(b"actual source WAV")
            return ""
        with patch("listening_context.make_clip", side_effect=clip), \
                patch("listening_context.load_queue") as validate:
            path = write_context_queue(study, self.root / "packet", "בראשית א א")
        validate.assert_called_once_with(path)
        self.assertTrue(path.is_file())
        with self.assertRaises(FileExistsError):
            write_context_queue(study, self.root / "packet", "בראשית א א")


if __name__ == "__main__":
    unittest.main()
