from contextlib import closing
from pathlib import Path
import tempfile
import unittest

import numpy as np

from acoustic import ctc_spans
from alignment import Word, normalize, reconcile, similarity, spoken, validate_timings, words_for
from recite import audio_hash, cached_transcript, completed_alignment, export_database, process_track, write_json
from review import accept_review


class AlignmentTests(unittest.TestCase):
    def test_failed_rerun_preserves_approved_output_and_review_is_not_recomputed(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        from alignment import text_hash
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            audio = root / "1_record.mp3"
            audio.write_bytes(b"test recording")
            chapter = {"pesukim": [{"segments": [{"type": "qri", "value": "ברא"}]}]}
            accepted = {"version": 1, "perekId": 1, "audioUrl": "https://example.com/1_record.mp3",
                "audioSha256": audio_hash(audio), "textSha256": text_hash(words_for(chapter)),
                "durationMs": 1000, "alignmentStatus": "ready", "reviewMethod": "listening",
                "words": [{"pasuk": 1, "segment": 1, "text": "ברא", "startMs": 100, "endMs": 500}]}
            write_json(root / "1.json", accepted)
            before = (root / "1.json").read_bytes()
            args = SimpleNamespace(output=root, cache=root, audio_base_url="https://example.com",
                                   force=False, prepare_only=False)
            with patch("recite.align_manifest", side_effect=RuntimeError("GPU unavailable")) as align, patch("recite.duration", return_value=1000):
                self.assertIsNone(process_track(audio, {1: chapter}, {"model": "updated"}, args))
                align.assert_not_called()
                args.force = True
                self.assertEqual(process_track(audio, {1: chapter}, {}, args), "GPU unavailable")
                self.assertEqual((root / "1.json").read_bytes(), before)
                align.side_effect = RuntimeError("CUDA error: out of memory")
                with self.assertRaisesRegex(MemoryError, "stopping the batch"):
                    process_track(audio, {1: chapter}, {}, args)
                self.assertEqual((root / "1.json").read_bytes(), before)

    def test_memory_failure_aborts_batch_and_records_failure(self):
        import json
        from types import SimpleNamespace
        from unittest.mock import patch
        from recite import main
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            args = SimpleNamespace(text=root / "perakim.json", output=root, cache=root, database=root / "recitation.sqlite",
                asr_model="asr", asr_revision="a", align_model="ctc", align_revision="b",
                min_text_score=.6, min_acoustic_score=.5, min_coverage=.85)
            with (patch("recite.parse_arguments", return_value=(None, args)),
                  patch("recite.load_chapters", return_value={}),
                  patch("recite.source_files", return_value=[root / "1_record.mp3", root / "2_record.mp3"]),
                  patch("recite.process_track", side_effect=MemoryError("CUDA out of memory")) as process,
                  patch("recite.export_database"), patch("publish.publish")):
                with self.assertRaises(SystemExit) as failed:
                    main()
                self.assertEqual(failed.exception.code, 1)
                self.assertEqual(process.call_count, 1)
            failures = json.loads((root / "failures.json").read_text(encoding="utf-8"))
            self.assertEqual(failures, [{"perekId": 1, "error": "CUDA out of memory"}])

    def test_completed_checkpoint_survives_interruption_before_next_track(self):
        import json
        import sqlite3
        from types import SimpleNamespace
        from unittest.mock import patch
        from recite import main
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            args = SimpleNamespace(text=root / "perakim.json", output=root / "cache", cache=root,
                database=root / "recitation.sqlite", asr_model="asr", asr_revision="a",
                align_model="ctc", align_revision="b", min_text_score=.6, min_acoustic_score=.5, min_coverage=.85)
            manifest = {"perekId": 1, "audioUrl": "https://example.com/1_record.mp3", "audioSha256": "a",
                "textSha256": "b", "durationMs": 1000, "alignmentStatus": "ready",
                "words": [{"pasuk": 1, "segment": 1, "text": "ברא", "startMs": 101, "endMs": 599}]}

            def process(path, *_):
                if path.name == "2_record.mp3":
                    raise KeyboardInterrupt()
                write_json(args.output / "1.json", manifest)

            with (patch("recite.parse_arguments", return_value=(None, args)),
                  patch("recite.load_chapters", return_value={}),
                  patch("recite.source_files", return_value=[root / "1_record.mp3", root / "2_record.mp3"]),
                  patch("recite.process_track", side_effect=process), patch("publish.publish") as publication):
                with self.assertRaises(KeyboardInterrupt):
                    main()
                publication.assert_not_called()
            with closing(sqlite3.connect(args.database)) as db:
                self.assertEqual(db.execute("SELECT start_ms,end_ms FROM recitation_word").fetchall(), [(101, 599)])

    def test_short_samples_are_prioritized_without_dropping_tracks(self):
        from types import SimpleNamespace
        from recite import source_files
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for pid in (1, 2, 3):
                (root / f"{pid}_record.mp3").touch()
            args = SimpleNamespace(recordings=root, perek=None, shortest_first=True)
            chapters = {1: {"recitation": {"durationMs": 5000}}, 2: {"recitation": {"durationMs": 1000}}, 3: {}}
            self.assertEqual([p.name for p in source_files(None, args, chapters)],
                             ["2_record.mp3", "1_record.mp3", "3_record.mp3"])
            args.shortest_first = False
            self.assertEqual([p.name for p in source_files(None, args, chapters)],
                             ["1_record.mp3", "2_record.mp3", "3_record.mp3"])

    def test_model_revisions_invalidate_asr_cache_but_preserve_human_review(self):
        cached = {"audioSha256": "audio", "model": "model", "revision": "old"}
        self.assertTrue(cached_transcript(cached, "audio", "model", "old"))
        self.assertFalse(cached_transcript(cached, "audio", "model", "new"))
        self.assertFalse(cached_transcript({k: v for k, v in cached.items() if k != "revision"}, "audio", "model", "old"))
        accepted = {"alignmentStatus": "ready", "pipeline": {"asrRevision": "old"}, "reviewMethod": "listening"}
        self.assertTrue(completed_alignment(accepted, {"asrRevision": "new"}, False))
        self.assertFalse(completed_alignment(accepted, {"asrRevision": "new"}, True))
        self.assertFalse(completed_alignment({**accepted, "reviewMethod": None}, {"asrRevision": "new"}, False))

    def test_normalization_and_spoken_divine_names(self):
        self.assertEqual(normalize("אֶת־ הָאָֽרֶץ׃"), "אתהארץ")
        self.assertEqual(spoken("יְהוָה"), "אדני")
        self.assertEqual(spoken("יֱהוִה"), "אלהים")
        self.assertGreater(similarity("אלהים", "אלוהים"), 0.8)

    def test_only_qri_is_spoken_including_orphan_qri(self):
        perek = {"pesukim": [{"segments": [
            {"type": "ktiv", "value": "כתיב", "qriOffset": 1},
            {"type": "qri", "value": "קרי", "ktivOffset": -1},
            {"type": "ktiv", "value": "יתום", "qriOffset": 0},
            {"type": "qri", "value": "נקרא", "ktivOffset": 0},
            {"type": "ptuha"}, {"type": "stuma"},
        ]}]}
        self.assertEqual([(w.segment, w.text) for w in words_for(perek)], [(2, "קרי"), (4, "נקרא")])

    def test_embedded_editorial_markup_is_not_treated_as_a_spoken_word(self):
        with self.assertRaisesRegex(ValueError, "Markup in canonical word"):
            words_for({"pesukim": [{"segments": [{"type": "qri", "value": "מְאֹד<small>[השיבנו]</small>"}]}]})

    def test_insertions_deletions_and_repeated_words_do_not_shift_tail(self):
        result = reconcile(["בראשית", "ברא", "אלהים", "את", "השמים", "ואת", "הארץ"],
                           ["הקדמה", "בראשית", "ברא", "אלוהים", "השמים", "ואת", "הארץ"])
        self.assertEqual(result[0][0], [1])
        self.assertEqual(result[-1][0], [6])
        self.assertLess(result[3][1], 0.6)
        self.assertEqual(reconcile(["אברהם", "אברהם"], ["אברהם", "אברהם"]), [([0], 1), ([1], 1)])

    def test_split_and_joined_words(self):
        self.assertEqual([x[0] for x in reconcile(["כל", "אשר"], ["כלאשר"])], [[0], [0]])
        self.assertEqual(reconcile(["ובראשית"], ["ו", "בראשית"])[0][0], [0, 1])

    def test_ctc_requires_blank_between_repeated_characters(self):
        # blank=0, letter=1. Two identical letters must occupy distinct spans.
        emissions = np.log(np.array([[.99, .01], [.01, .99], [.99, .01], [.01, .99], [.99, .01]]))
        spans = ctc_spans(emissions, [1, 1], 0)
        self.assertEqual([(s, e) for s, e, _ in spans], [(1, 2), (3, 4)])
        with self.assertRaises(ValueError):
            ctc_spans(emissions[:2], [1, 1], 0)

    def test_ctc_rejects_short_audio(self):
        with self.assertRaises(ValueError):
            ctc_spans(np.zeros((1, 3)), [1, 2], 0)

    def test_published_timings_reject_partial_stale_and_overlapping_verses(self):
        words = [Word(1, 1, "בראשית"), Word(1, 2, "ברא")]
        rows = [{"pasuk": 1, "segment": 1, "text": "בראשית", "startMs": 100, "endMs": 400},
                {"pasuk": 1, "segment": 2, "text": "ברא", "startMs": 450, "endMs": 700}]
        validate_timings(words, rows, 1000)
        for invalid in (rows[:1], rows + rows, [{**rows[0], "text": "אחר"}, rows[1]],
                        [rows[0], {**rows[1], "startMs": 399}],
                        [rows[0], {**rows[1], "endMs": 1001}]):
            with self.assertRaises(ValueError):
                validate_timings(words, invalid, 1000)

    def test_database_export_is_idempotent(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            manifest = {"perekId": 1, "audioUrl": "https://example.com/audio.mp3", "audioSha256": "a",
                        "textSha256": "b", "durationMs": 1000, "alignmentStatus": "ready", "words": [
                            {"pasuk": 1, "segment": 1, "text": "ברא", "startMs": 100, "endMs": 500}]}
            write_json(path / "1.json", manifest)
            for _ in range(2):
                export_database(path, path / "timings.sqlite")
            with closing(sqlite3.connect(path / "timings.sqlite")) as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM recitation_word").fetchone()[0], 1)
                self.assertEqual(db.execute("SELECT start_ms, end_ms FROM recitation_word").fetchone(), (100, 500))

    def test_intermediate_database_survives_partial_runs_and_regeneration(self):
        import copy
        import json
        from alignment import text_hash
        from publish import extract, publish
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            cache = path / "cache"
            perek = {"pesukim": [{"segments": [{"type": "qri", "value": "ברא",
                "recordingTimeFrame": {"from": "00:00:00", "to": "00:00:00"}}]}]}
            words = words_for(perek)
            record = {"version": 1, "perekId": 1, "audioUrl": "https://example.com/recordings/1_record.mp3",
                "audioSha256": "a" * 64, "textSha256": text_hash(words), "durationMs": 1000,
                "alignmentStatus": "ready", "words": [{"pasuk": 1, "segment": 1, "text": "ברא", "startMs": 101, "endMs": 599}]}
            write_json(cache / "1.json", record)
            intermediate = path / "recitation.sqlite"
            export_database(cache, intermediate)
            # A partial processing directory must not wipe approved tracks.
            (cache / "1.json").unlink()
            export_database(cache, intermediate)
            database = path / "perakim.json"
            regenerated = [{"perekFrom": 1, "perakim": [perek]}]
            for _ in range(2):
                write_json(database, copy.deepcopy(regenerated))
                publish(intermediate, database)
                self.assertNotIn(b"\r\n", database.read_bytes())
                merged = json.loads(database.read_text(encoding="utf-8"))[0]["perakim"][0]
                self.assertEqual(extract(1, merged), record)
                self.assertNotIn("words", merged["recitation"])
            # Stale text must fail before overwriting a regenerated output.
            perek["pesukim"][0]["segments"][0]["value"] = "שונה"
            write_json(database, regenerated)
            before = database.read_bytes()
            with self.assertRaisesRegex(ValueError, "Canonical words changed"):
                publish(intermediate, database)
            self.assertEqual(database.read_bytes(), before)

    def test_complete_chapter_cannot_drop_a_whole_verse(self):
        words = [Word(1, 1, "ברא"), Word(2, 1, "אלהים")]
        rows = [{"pasuk": 1, "segment": 1, "text": "ברא", "startMs": 100, "endMs": 500}]
        with self.assertRaises(ValueError):
            validate_timings(words, rows, 1000, require_complete=True)

    def test_review_rejects_stale_audio_missing_words_and_unreviewed_candidates(self):
        from alignment import text_hash
        words = [Word(1, 1, "ברא"), Word(2, 1, "אלהים")]
        rows = [{"pasuk": w.pasuk, "segment": w.segment, "text": w.text,
                 "startMs": i * 300, "endMs": i * 300 + 200, "reviewed": True}
                for i, w in enumerate(words)]
        manifest = {"perekId": 1, "audioSha256": "audio", "textSha256": text_hash(words),
                    "durationMs": 1000, "alignmentStatus": "needs_review", "words": rows}
        self.assertEqual(accept_review(manifest, manifest, words)["alignmentStatus"], "ready")
        for invalid in ({**manifest, "audioSha256": "different"},
                        {**manifest, "words": rows[:1]},
                        {**manifest, "words": [{**r, "reviewed": False} for r in rows]}):
            with self.assertRaises(ValueError):
                accept_review(manifest, invalid, words)


if __name__ == "__main__":
    unittest.main()
