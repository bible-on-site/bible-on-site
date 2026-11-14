"""Check retained real-model evidence without importing model runtimes."""

import base64
import collections
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import unittest

ROOT = Path(__file__).resolve().parent / "golden" / "gpu-metrics"


def _sha(raw):
    """Hash exact archived bytes independently of checkout line endings."""
    return hashlib.sha256(raw).hexdigest()


def _canonical(value):
    """Rebuild the recorded request serialization."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


class TestRecordedQualification(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ROOT / "qualification-evidence-manifest.json").read_bytes())
        cls.compressed = (ROOT / cls.manifest["archive"]).read_bytes()
        cls.raw = gzip.decompress(cls.compressed)
        cls.archive = json.loads(cls.raw)
        cls.contents = {entry["path"]: base64.b64decode(entry["base64"], validate=True)
                        for entry in cls.archive["entries"]}

    def test_archive_preserves_each_raw_file_and_has_only_portable_paths(self):
        self.assertEqual(_sha(self.compressed), self.manifest["archive_sha256"])
        self.assertEqual(_sha(self.raw), self.manifest["uncompressed_sha256"])
        self.assertEqual(self.compressed[4:8], bytes(4))
        self.assertEqual(self.manifest["validation_errors"], [])
        self.assertEqual(self.manifest["provenance_warnings"], [])
        self.assertEqual(len(self.contents), len(self.archive["entries"]))
        expected = {entry["path"]: entry for entry in self.manifest["entries"]}
        self.assertEqual(set(self.contents), set(expected))
        self.assertEqual(self.archive["path_map"], self.manifest["path_map"])
        for path, raw in self.contents.items():
            with self.subTest(path=path):
                self.assertFalse(PurePosixPath(path).is_absolute())
                self.assertNotIn("..", PurePosixPath(path).parts)
                self.assertNotIn(":", path)
                self.assertNotIn("\\", path)
                self.assertEqual(len(raw), expected[path]["bytes"])
                self.assertEqual(_sha(raw), expected[path]["sha256"])
        for path, alias in self.archive["path_map"].items():
            self.assertFalse(PurePosixPath(path).is_absolute())
            self.assertNotIn("..", PurePosixPath(path).parts)
            self.assertNotIn(":", path)
            self.assertNotIn("\\", path)
            self.assertIn(alias, self.contents)

    def test_captured_gpu_outputs_match_their_exact_model_and_request_context(self):
        checked = 0
        for path, raw in self.contents.items():
            if not path.startswith("request-evidence/") or path.endswith(".validation.json"):
                continue
            record = json.loads(raw)
            with self.subTest(path=path):
                self.assertEqual(record["messages_sha256"], _sha(_canonical(record["messages"])))
                self.assertEqual(record["output_sha256"], _sha(record["output"].encode("utf-8")))
                self.assertEqual(record["request_key"],
                                 _sha(_canonical([record["cache_revision"], record["messages"]])))
                if record["source"] == "new_gpu_generation":
                    self.assertEqual(record["actual_generation_revision"], record["cache_revision"])
                    self.assertTrue(record["actual_generation_environment"]["device"].startswith("cuda:"))
                    self.assertEqual(record["new_gpu_stats_for_request"]["generated_requests"], 1)
                    self.assertGreater(record["new_gpu_stats_for_request"]["input_tokens"], 0)
                elif record["source"] == "old_captured_gpu_response":
                    proof = record["source_proof"]
                    self.assertEqual(proof["request_key"],
                                     _sha(_canonical([record["actual_generation_revision"], record["messages"]])))
                    self.assertEqual(proof["status"], "captured")
                    self.assertTrue(proof["captures"])
                    for capture in proof["captures"]:
                        capture_raw = self.contents[self.archive["path_map"][capture["raw_path"]]]
                        original = json.loads(capture_raw)
                        self.assertEqual(_sha(capture_raw), capture["raw_file_sha256"])
                        self.assertEqual(original["revision"], record["actual_generation_revision"])
                        self.assertEqual(original["output"], record["output"])
                else:
                    self.assertIn(record["source"], {"current_profile_cache", "qualification_failed_raw_replay"})
                    parent = json.loads(self.contents[self.archive["path_map"][record["inherited_evidence"]]])
                    self.assertEqual(parent["output_sha256"], record["output_sha256"])
            checked += 1
        self.assertGreater(checked, 0)

    def test_measured_reports_keep_their_bytes_and_separate_replay_from_new_generation(self):
        views = {view["relative_path"]: view for view in self.manifest["published_report_views"]}
        for reference in self.manifest["measured_reports_unchanged"]:
            relative = reference["relative_path"]
            with self.subTest(report=relative):
                raw = self.contents["reports/" + relative]
                self.assertEqual(_sha(raw), reference["sha256"])
                published = (ROOT / relative).read_bytes()
                self.assertEqual(published, raw.replace(b'"request_key":', b'"request_sha256":'))
                self.assertEqual(_sha(published), views[relative]["sha256"])
                self.assertEqual(_sha(raw), views[relative]["measured_sha256"])
                report = json.loads(raw)
                records = []
                for evidence in report["qualification"]["request_evidence"]:
                    record_raw = self.contents[self.archive["path_map"][evidence["path"]]]
                    self.assertEqual(_sha(record_raw), evidence["sha256"])
                    records.append(json.loads(record_raw))
                sources = collections.Counter(record["source"] for record in records)
                self.assertEqual(dict(sources), report["qualification"]["returned_response_sources"])
                self.assertEqual(sources["new_gpu_generation"],
                                 report["qualification"]["actual_new_gpu_stats"]["generated_requests"])
                self.assertTrue(all(record["cache_revision"] == report["model_revision"] for record in records))

    def test_supported_cpu_profile_matches_the_recorded_gpu_classifier_results(self):
        cpu_root = ROOT / "cpu-profile-2-15"
        comparison = json.loads((cpu_root / "comparison.json").read_bytes())
        self.assertTrue(comparison["completed"])
        self.assertFalse(comparison["adapter_override"])
        self.assertFalse(comparison["cuda_initialized"])
        for split in ("development", "validation"):
            cpu = json.loads((cpu_root / (split + ".json")).read_bytes())
            gpu = json.loads((ROOT / split / "dictabert-ner-retype.json").read_bytes())
            self.assertEqual(cpu["execution"]["device"], "cpu")
            self.assertEqual(cpu["execution"]["dtype"], "float32")
            self.assertIsNone(cpu["execution"]["cuda_runtime"])
            self.assertEqual(cpu["candidate"], gpu["candidate"])
            for domain in ("pasuk", "article"):
                for key in ("counts", "metrics", "per_case", "per_category"):
                    with self.subTest(split=split, domain=domain, field=key):
                        self.assertTrue(comparison["splits"][split][domain][key])
                        self.assertEqual(cpu[domain][key], gpu[domain][key])

    def test_real_publisher_pilots_resume_identically_with_measured_profile_ids(self):
        root = ROOT / "publish-pilot"
        manifest = json.loads((root / "manifest.json").read_bytes())
        self.assertFalse(manifest["production_import_performed"])
        self.assertTrue(manifest["article_inputs_are_synthetic_fixtures"])
        for relative, digest in manifest["artifact_sha256"].items():
            self.assertEqual(_sha((root / relative).read_bytes()), digest)
        fixture = {article["id"]: article["content"] for article in
                   json.loads((root / "articles-fixture.json").read_bytes())}
        for profile in manifest["profiles"]:
            with self.subTest(engine=profile["engine"], domain=profile["domain"]):
                raw = (root / profile["rows_file"]).read_bytes()
                cold = json.loads((root / profile["cold_provenance"]).read_bytes())
                warm = json.loads((root / profile["warm_provenance"]).read_bytes())
                self.assertEqual(_sha(raw), cold["rows_sha256"])
                self.assertEqual(_sha(raw), warm["rows_sha256"])
                self.assertTrue(cold["model_loaded_this_run"])
                self.assertFalse(warm["model_loaded_this_run"])
                self.assertTrue(cold["complete_valid_responses"])
                self.assertTrue(warm["complete_valid_responses"])
                self.assertEqual(cold["checkpoint"]["misses"], profile["source_units"])
                self.assertEqual(warm["checkpoint"]["hits"], profile["source_units"])
                self.assertEqual(warm["checkpoint"]["misses"], 0)
                report = json.loads((ROOT / profile["qualification_report"]).read_bytes())
                if profile["engine"] == "classifier":
                    domain = "pasuk" if profile["domain"] == "pasuk" else "article"
                    expected = report[domain]["model_revision"]
                else:
                    expected = report["model_revision"]
                    self.assertEqual(warm["request_cache"]["model_calls"], 0)
                self.assertEqual(cold["model_revision"], expected)
                self.assertEqual(warm["model_revision"], expected)
                self.assertFalse(profile["semantic_quality_promoted"])
                rows = json.loads(raw)
                self.assertEqual(len(rows), profile["rows"])
                for row in rows:
                    if row["source_kind"] == "article":
                        content = fixture[row["article_id"]]
                        surface = content.encode("utf-16-le")[
                            2 * row["span_start"]:2 * row["span_end"]].decode("utf-16-le")
                        self.assertEqual(row["surface"], surface)
                        self.assertEqual(row["content_hash"], _sha(content.encode("utf-8")))


if __name__ == "__main__":
    unittest.main()
