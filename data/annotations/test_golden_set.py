"""Golden-set consistency tests (issue #2516).

Loads the real golden files and canonical dump and asserts the curated
labels stay in sync with the sources — gold `text`/`surface` fields are
re-derived from the actual bytes, spans resolve, and the categories the
issue requires are covered. The recorded-metrics check regenerates the
full evaluation (~30 s) and diffs the deterministic fields against
`golden/metrics-baseline.json`, so a deliberate pipeline change must
re-record the baseline via `golden_eval.py --write`.
"""

import unittest

import golden_eval as ge


PASUK_REQUIRED = {
    "ordinary-nouns",
    "ambiguity",
    "multi-word",
    "prefixes",
    "vocalization",
    "qri-ktiv",
    "gentilic",
    "recall-gap",
}
ARTICLE_REQUIRED = {
    "ordinary-nouns",
    "ambiguity",
    "multi-word",
    "prefixes",
    "quoted-scripture",
    "anchors",
    "homographs",
    "coverage-gap",
    "skip-zones",
    "spelling",
    "utf16",
}


class TestGoldenConsistency(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pasuk = ge.load_golden(ge.GOLDEN_DIR / "pesukim.json")
        cls.articles = ge.load_golden(ge.GOLDEN_DIR / "articles.json")
        cls.sefarim = ge.baseline.load_canonical()

    def test_pasuk_gold_fields_match_sources(self):
        for case in self.pasuk["cases"]:
            perek, stem, chapter = ge.resolve_pasuk(case, self.sefarim)
            self.assertTrue(
                stem and chapter, f"{case['id']}: perek not found"
            )
            golds = ge.resolve_pasuk_mentions(case, perek)
            self.assertEqual(len(golds), len(case["mentions"]))

    def test_article_gold_fields_match_content(self):
        for case in self.articles["cases"]:
            golds = ge.resolve_article_mentions(case)
            self.assertEqual(len(golds), len(case["mentions"]))
            # Resolved spans slice the exact stored surface.
            for gold, mention in zip(golds, case["mentions"]):
                start, end = gold["span"]
                self.assertEqual(
                    case["content"]
                    .encode("utf-16-le")[start * 2 : end * 2]
                    .decode("utf-16-le"),
                    mention["surface"],
                )

    def test_case_ids_are_unique_across_domains(self):
        ids = [c["id"] for c in self.pasuk["cases"]] + [
            c["id"] for c in self.articles["cases"]
        ]
        self.assertEqual(len(ids), len(set(ids)))

    def test_required_categories_covered(self):
        pasuk_categories = {
            cat
            for case in self.pasuk["cases"]
            for cat in case.get("categories", [])
        }
        article_categories = {
            cat
            for case in self.articles["cases"]
            for cat in case.get("categories", [])
        }
        self.assertFalse(PASUK_REQUIRED - pasuk_categories)
        self.assertFalse(ARTICLE_REQUIRED - article_categories)

    def test_declared_categories_are_used(self):
        declared = set(self.pasuk["categories"]) | set(
            self.articles["categories"]
        )
        used = {
            cat
            for case in self.pasuk["cases"] + self.articles["cases"]
            for cat in case.get("categories", [])
        }
        # Every used category must be declared (typos fail here).
        self.assertFalse(used - declared)

    def test_mentions_have_names_and_types(self):
        for case in self.pasuk["cases"] + self.articles["cases"]:
            for mention in case["mentions"]:
                self.assertTrue(mention["name"], case["id"])
                self.assertTrue(mention["type"], case["id"])


class TestRecordedMetrics(unittest.TestCase):
    """End-to-end: real corpus + real pipelines vs the recorded baseline."""

    @classmethod
    def setUpClass(cls):
        cls.report = ge.evaluate()

    def test_deterministic_metrics_match_recorded_baseline(self):
        import json

        recorded = json.loads(
            ge.METRICS_PATH.read_text(encoding="utf-8")
        )
        self.assertEqual(ge.deterministic(self.report), recorded)

    def test_report_shape(self):
        for domain in ("pasuk", "article"):
            d = self.report[domain]
            self.assertTrue(d["model_revision"])
            self.assertGreater(d["cases"], 0)
            self.assertGreater(d["gold_auto"], 0)
            for key in (
                "precision",
                "recall",
                "f1",
                "detection_recall",
                "type_accuracy",
                "name_accuracy",
                "span_exactness",
            ):
                self.assertIn(key, d["metrics"])

    def test_baseline_findings_still_hold(self):
        """The golden set's documented gaps must remain measurable.

        The lexical tier's type skew and the name-form misses are the
        numbers the encoder tier is compared against; if a future fix
        eliminates them, this test forces the numbers (and docs) to be
        revisited rather than silently going stale.
        """
        pasuk = self.report["pasuk"]["metrics"]
        article = self.report["article"]["metrics"]
        # Type accuracy is the documented weak point (< 0.7 today).
        self.assertLess(pasuk["type_accuracy"], 0.7)
        # Both domains must keep some recall misses on record.
        self.assertLess(pasuk["recall"], 1.0)
        self.assertLess(article["recall"], 1.0)


if __name__ == "__main__":
    unittest.main()
