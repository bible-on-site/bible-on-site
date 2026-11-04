"""Unit tests for verify_android_dex_metadata.py."""

import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import verify_android_dex_metadata as dex

# Compliant fixture shares: Play scores are 100 − each no*Percentage, so
# 50/40/40 untouched → 50/60/60 processed, all above the 25% minimum.
_STATS = {
    "noObfuscationPercentage": 50.0,
    "noOptimizationPercentage": 40.0,
    "noShrinkingPercentage": 40.0,
}

# Sentinel default: stats=None must mean "emit r8.json without a stats object".
_STATS_ABSENT = object()


def _r8_json(stats=_STATS_ABSENT, **overrides):
    options = {
        "isObfuscationEnabled": True,
        "isShrinkingEnabled": True,
        "isOptimizationsEnabled": True,
    }
    options.update(overrides)
    document = {"version": "8.x", "options": options}
    if stats is _STATS_ABSENT:
        stats = _STATS
    if stats is not None:
        document["stats"] = stats
    return json.dumps(document).encode()


def _proguard_map(class_renames=3):
    lines = ["# generated map"]
    for index in range(class_renames):
        lines.append(f"com.example.Class{index} -> a.b.{index}:")
        lines.append(f"    1:1:void method{index}() -> a")
    return "\n".join(lines).encode()


def _write_aab(path, *, metadata=_r8_json(), mapping=_proguard_map(), dex_size=12 * 1024 * 1024):
    with zipfile.ZipFile(path, "w") as archive:
        if metadata is not None:
            archive.writestr(dex.R8_METADATA_ENTRY, metadata)
        if mapping is not None:
            archive.writestr(dex.PROGUARD_MAP_ENTRY, mapping)
        archive.writestr("base/dex/classes.dex", b"dex\n035" + b"\0" * max(0, dex_size - 8))
        archive.writestr("base/manifest/AndroidManifest.xml", b"manifest")


class AndroidDexMetadataTests(unittest.TestCase):
    def test_rejects_metadata_missing_flags_play_scores(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / "app.aab"
            for overrides in [
                {"isObfuscationEnabled": False},
                {"isShrinkingEnabled": False},
                {"isOptimizationsEnabled": False},
            ]:
                _write_aab(package, metadata=_r8_json(**overrides))
                with self.assertRaises(ValueError):
                    dex.verify(package)

    def test_rejects_missing_metadata_and_mapping_entries(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / "app.aab"
            _write_aab(package, metadata=None)
            with self.assertRaises(ValueError):
                dex.verify(package)
            _write_aab(package, mapping=None)
            with self.assertRaises(ValueError):
                dex.verify(package)

    def test_rejects_invalid_metadata_and_non_obfuscating_map(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / "app.aab"
            _write_aab(package, metadata=b"not json")
            with self.assertRaises(ValueError):
                dex.verify(package)
            # A map whose lines only map names to themselves means obfuscation
            # never ran even if r8.json claims it did.
            _write_aab(package, mapping=b"com.example.Keep -> com.example.Keep:\n")
            with self.assertRaises(ValueError):
                dex.verify(package)
            _write_aab(package, mapping=_proguard_map(class_renames=0))
            with self.assertRaises(ValueError):
                dex.verify(package)

    def test_missing_dex_and_missing_bundle_fail(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / "app.aab"
            with zipfile.ZipFile(package, "w") as archive:
                archive.writestr(dex.R8_METADATA_ENTRY, _r8_json())
                archive.writestr(dex.PROGUARD_MAP_ENTRY, _proguard_map())
            with self.assertRaises(ValueError):
                dex.verify(package)
            with self.assertRaises(ValueError):
                dex.verify(Path(temporary) / "absent.aab")

    def test_compliant_bundle_reports_dex_accounting_and_play_scores(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / "app.aab"
            _write_aab(package)
            summary = dex.verify(package)
            self.assertTrue(summary["overApplicabilityThreshold"])
            self.assertGreater(summary["dexUncompressedMB"], 10)
            self.assertEqual(3, summary["mappingClassRenames"])
            self.assertEqual(3, summary["mappingMemberRenames"])
            self.assertEqual(
                {"obfuscation": 50.0, "optimization": 60.0, "shrinking": 60.0},
                summary["playScores"],
            )

    def test_small_dex_bundle_still_requires_enabled_flags(self):
        # Below Play's 10 MB applicability threshold the flags are not enforced
        # by Play, but our Release config must still produce them — report the
        # bundle as compliant and below-threshold rather than skipping checks.
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / "app.aab"
            _write_aab(package, dex_size=1024)
            summary = dex.verify(package)
            self.assertFalse(summary["overApplicabilityThreshold"])

    def test_singular_optimization_key_is_accepted(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / "app.aab"
            metadata = json.dumps({"options": {
                "isObfuscationEnabled": True,
                "isShrinkingEnabled": True,
                "isOptimizationEnabled": True,
            }, "stats": _STATS}).encode()
            _write_aab(package, metadata=metadata)
            dex.verify(package)

    def test_rejects_missing_or_non_numeric_stats(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / "app.aab"
            _write_aab(package, metadata=_r8_json(stats=None))
            with self.assertRaises(ValueError):
                dex.verify(package)
            stats = dict(_STATS, noObfuscationPercentage="high")
            _write_aab(package, metadata=_r8_json(stats=stats))
            with self.assertRaises(ValueError):
                dex.verify(package)

    def test_sub_minimum_score_fails_over_threshold(self):
        # Enabled flags plus a token rename cannot substitute for Play's 25%:
        # 90% untouched obfuscation means a 10% score on a >10 MB DEX bundle.
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / "app.aab"
            stats = dict(_STATS, noObfuscationPercentage=90.0)
            _write_aab(package, metadata=_r8_json(stats=stats))
            with self.assertRaises(ValueError) as context:
                dex.verify(package)
            self.assertIn("obfuscation 10.0%", str(context.exception))

    def test_sub_minimum_score_passes_under_threshold(self):
        # Play does not enforce the 25% floors below 10 MB DEX; the bundle is
        # still reported with its measured scores rather than gated.
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / "app.aab"
            stats = dict(_STATS, noObfuscationPercentage=90.0)
            _write_aab(package, metadata=_r8_json(stats=stats), dex_size=1024)
            summary = dex.verify(package)
            self.assertEqual(10.0, summary["playScores"]["obfuscation"])


if __name__ == "__main__":
    unittest.main()
