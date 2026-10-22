"""Fresh listening proposals must use actual model boundaries, never guessed gaps."""

from copy import deepcopy
import unittest

from listening_tail import PATH_METHOD, propose_path_boundaries, verify_corrections


class ListeningTailTests(unittest.TestCase):
    def setUp(self):
        self.rows = [{"pasuk": 1, "segment": 2, "text": "רוח", "startMs": 200,
                      "endMs": 500, "acousticScore": .8}]
        self.evidence = [{"pasuk": 1, "segment": 2, "letterStartMs": 200, "letterEndMs": 500,
                          "letterAcousticScore": .8, "precedingWordEndMs": 100,
                          "precedingSeparatorStartMs": 120, "precedingSeparatorEndMs": 160,
                          "separatorStartMs": 520, "separatorEndMs": 540, "followingWordStartMs": 600}]

    def diagnostic(self):
        rows, changes = propose_path_boundaries(self.rows, self.evidence,
            {(1, 2): {"start": "precedingSeparatorEndMs", "end": "followingWordStartMs"}})
        return {"boundaryMethod": PATH_METHOD, "letterCandidates": deepcopy(self.rows),
                "diagnosticCandidates": rows, "boundaryCorrections": changes}

    def test_boundary_changes_keep_canonical_words_scores_and_actual_path(self):
        diagnostic = self.diagnostic()
        verify_corrections(diagnostic)
        row = diagnostic["diagnosticCandidates"][0]
        self.assertEqual((row["startMs"], row["endMs"]), (160, 600))
        self.assertEqual(row["text"], self.rows[0]["text"])
        self.assertEqual(row["acousticScore"], .8)
        self.assertEqual(self.rows[0]["startMs"], 200)

    def test_fabricated_edges_scores_and_duplicate_or_missing_proof_are_rejected(self):
        diagnostic = self.diagnostic()
        mutations = (
            lambda d: d["diagnosticCandidates"][0].update(endMs=601),
            lambda d: d["diagnosticCandidates"][0].update(startMs=159),
            lambda d: d["diagnosticCandidates"][0].update(acousticScore=.9),
            lambda d: d["boundaryCorrections"].append(deepcopy(d["boundaryCorrections"][0])),
            lambda d: d.update(boundaryCorrections=[]),
            lambda d: d["boundaryCorrections"][0].update(startBoundary="manual-padding"),
        )
        for mutate in mutations:
            changed = deepcopy(diagnostic)
            mutate(changed)
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                verify_corrections(changed)


if __name__ == "__main__":
    unittest.main()
