"""Handoff keeps finished inference and incomplete intervals truthful."""

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from checkpoint_handoff import completed_manifest_logged, recover_checkpoint


class CheckpointHandoffTests(unittest.TestCase):
    def test_only_complete_target_manifest_stdout_allows_handoff(self):
        self.assertTrue(completed_manifest_logged("763: 261/261 word identities; needs_review; 4841.1s\n", 763))
        self.assertTrue(completed_manifest_logged("763: 261/261 word identities; ready; 4841.1s\n", 763))
        for line in ("ASR progress: 201.3/219.6s", "763: already processed", "763: FAILED",
                     "1763: 261/261 word identities; ready; 4841.1s",
                     "763: 260/261 word identities; ready; 4841.1s",
                     "763: 261/261 word identities; pending; 4841.1s"):
            self.assertFalse(completed_manifest_logged(line, 763), line)

    def test_rebuild_preserves_missing_intervals_and_exact_provenance(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "alignments"
            output.mkdir()
            manifest = {"version": 1, "perekId": 763, "audioUrl": "https://example.com/763.mp3",
                        "audioSha256": "audio", "textSha256": "canonical", "durationMs": 1000,
                        "alignmentStatus": "needs_review", "executionProfile": {"source": "inference"},
                        "words": [{"pasuk": 1, "segment": 1, "text": "ברא", "startMs": 100, "endMs": 200},
                                  {"pasuk": 1, "segment": 2, "text": "אלהים", "startMs": None, "endMs": None}]}
            (output / "763.json").write_text(json.dumps(manifest), encoding="utf-8")
            result = recover_checkpoint(output, root / "checkpoint.sqlite", 763)
            self.assertEqual(result["canonicalWords"], 2)
            self.assertEqual(result["storedIntervals"], 0)
            self.assertEqual(result["status"], "needs_review")
            self.assertEqual(recover_checkpoint(output, root / "checkpoint.sqlite", 763), result)


if __name__ == "__main__":
    unittest.main()
