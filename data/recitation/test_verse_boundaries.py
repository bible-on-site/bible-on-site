from types import SimpleNamespace
import unittest
from unittest.mock import Mock

import numpy as np

from alignment import Word, validate_timings
from recite import align_track


class VerseBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.words = [Word(1, 1, "ברא"), Word(2, 1, "אלהים")]
        self.audio = np.zeros(10 * 16000, dtype=np.float32)
        self.recognized = [{"text": "ברא", "start": 1.0, "end": 2.0},
                           {"text": "אלהים", "start": 2.0, "end": 3.0}]
        self.args = SimpleNamespace(min_text_score=.6, min_acoustic_score=.5, min_coverage=.85)

    def test_overlapping_windows_are_realigned_jointly_using_the_model_boundaries(self):
        aligner = Mock()
        aligner.align.side_effect = [[(.3, 1.8, .4)], [(.15, .65, .9)],
                                    [(.35, 1.1, .9), (1.4, 2.3, .9)]]
        rows, reviews = align_track(self.audio, self.words, self.recognized, aligner, self.args)
        self.assertEqual(aligner.align.call_count, 3)
        self.assertEqual(aligner.align.call_args.args[1], ["ברא", "אלהים"])
        self.assertEqual([(r["startMs"], r["endMs"]) for r in rows], [(1000, 1750), (2050, 2950)])
        self.assertEqual(reviews, [])
        validate_timings(self.words, rows, 10000, require_complete=True)

    def test_nonoverlapping_candidates_and_their_quality_warnings_are_preserved(self):
        self.recognized[1].update(start=3.0, end=4.0)
        aligner = Mock()
        aligner.align.side_effect = [[(.35, 1.35, .4)], [(.35, 1.35, .9)]]
        rows, reviews = align_track(self.audio, self.words, self.recognized, aligner, self.args)
        self.assertEqual(aligner.align.call_count, 2)
        self.assertEqual([(r["startMs"], r["endMs"]) for r in rows], [(1000, 2000), (3000, 4000)])
        self.assertEqual(len(reviews), 1)
        self.assertEqual(reviews[0]["suspectWords"][0]["acousticScore"], .4)

    def test_failed_joint_alignment_is_held_for_review_without_clamping(self):
        aligner = Mock()
        aligner.align.side_effect = [[(.3, 1.8, .4)], [(.15, .65, .9)], ValueError("no acoustic path")]
        rows, reviews = align_track(self.audio, self.words, self.recognized, aligner, self.args)
        self.assertEqual([(r["startMs"], r["endMs"]) for r in rows], [(950, 2450), (1800, 2300)])
        self.assertTrue(any("joint verse alignment failed" in r["reason"] for r in reviews))
        self.assertTrue(any("still overlap" in r["reason"] for r in reviews))

    def test_joint_window_limit_is_enforced_before_loading_a_larger_acoustic_input(self):
        self.audio = np.zeros(80 * 16000, dtype=np.float32)
        self.recognized[0].update(start=1.0, end=40.0)
        self.recognized[1].update(start=39.9, end=75.0)
        aligner = Mock()
        aligner.align.side_effect = [[(39.0, 39.5, .4)], [(.1, .8, .9)]]
        _, reviews = align_track(self.audio, self.words, self.recognized, aligner, self.args)
        self.assertEqual(aligner.align.call_count, 2)
        self.assertTrue(any("45-second limit" in r["reason"] for r in reviews))


if __name__ == "__main__":
    unittest.main()
