from contextlib import closing
from pathlib import Path
import tempfile
import unittest

import numpy as np

from acoustic import ctc_spans
from alignment import Word, normalize, reconcile, similarity, spoken, validate_timings, words_for
from recite import export_database, write_json
from review import accept_review


class AlignmentTests(unittest.TestCase):
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
