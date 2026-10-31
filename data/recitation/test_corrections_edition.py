"""Corrected-edition manifests stay bound to the artifacts they describe."""

import hashlib
import json
from pathlib import Path
import shutil
import subprocess  # nosec B404: fixed ffprobe argv, never a shell.
import unittest

CORRECTIONS = Path(__file__).parent / "corrections"


def editions():
    return sorted(CORRECTIONS.glob("*/edition.json"))


class EditionManifestTests(unittest.TestCase):
    def test_every_edition_file_matches_its_pinned_hash(self):
        self.assertTrue(editions(), "expected at least one corrected edition")
        for manifest in editions():
            edition = json.loads(manifest.read_text(encoding="utf-8"))["edition"]
            artifact = manifest.parent / edition["file"]
            with self.subTest(edition=edition["file"]):
                self.assertTrue(artifact.is_file(), f"missing artifact {artifact}")
                self.assertEqual(
                    hashlib.sha256(artifact.read_bytes()).hexdigest(),
                    edition["sha256"],
                    "artifact drifted from the pinned edition hash",
                )

    def test_splice_windows_are_well_formed(self):
        for manifest in editions():
            data = json.loads(manifest.read_text(encoding="utf-8"))
            for edit in data["edits"]:
                removed = edit["target"]["removedSec"]
                inserted = edit["donor"]["insertedSec"]
                with self.subTest(manifest=manifest, word=edit["donor"]["word"]):
                    for window in (removed, inserted):
                        self.assertEqual(len(window), 2)
                        self.assertLess(window[0], window[1], "window must be increasing")
                        self.assertGreaterEqual(window[0], 0)
                    # The donor window must not run past the original file's end.
                    self.assertLessEqual(inserted[1], data["original"]["durationSec"])
                    # The removed window must not run past the original file's end either.
                    self.assertLessEqual(removed[1], data["original"]["durationSec"])

    def test_documented_durations_match_the_splice_arithmetic(self):
        for manifest in editions():
            data = json.loads(manifest.read_text(encoding="utf-8"))
            removed = sum(e["target"]["removedSec"][1] - e["target"]["removedSec"][0] for e in data["edits"])
            inserted = sum(e["donor"]["insertedSec"][1] - e["donor"]["insertedSec"][0] for e in data["edits"])
            expected = data["original"]["durationSec"] - removed + inserted
            with self.subTest(manifest=manifest):
                # Crossfades and encoder padding shift the length slightly.
                self.assertAlmostEqual(data["edition"]["durationSec"], expected, delta=0.15)

    def test_edition_duration_matches_ffprobe_when_available(self):
        ffprobe = shutil.which("ffprobe")
        if not ffprobe:
            self.skipTest("ffprobe not on PATH")
        for manifest in editions():
            edition = json.loads(manifest.read_text(encoding="utf-8"))["edition"]
            artifact = manifest.parent / edition["file"]
            out = subprocess.run(  # nosec B603: resolved ffprobe, fixed argv.  # nosemgrep
                [ffprobe, "-v", "error", "-show_entries", "format=duration",
                 "-of", "csv=p=0", str(artifact)],
                check=True, capture_output=True, text=True).stdout.strip()
            with self.subTest(edition=edition["file"]):
                self.assertAlmostEqual(float(out), edition["durationSec"], delta=0.05)


if __name__ == "__main__":
    unittest.main()
