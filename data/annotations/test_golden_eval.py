"""Unit tests for the golden-set evaluation harness (issue #2516)."""

import collections
import json
import tempfile
import unittest
import unittest.mock
from pathlib import Path

mock = unittest.mock

import golden_eval as ge


def gold(span, name="דוד", type_="PERSON", expected="auto", **kw):
    mention = {"start": span[0], "end": span[1], "text": "x", "name": name,
               "type": type_, "expected": expected}
    mention.update(kw)
    return ge._gold_row(span, mention)


def pred_pasuk(start, end, name="דוד", type_="PERSON", acceptance="auto"):
    return {
        "source_kind": "pasuk",
        "segment_start": start,
        "segment_end": end,
        "intended_name": name,
        "entity_type": type_,
        "acceptance": acceptance,
    }


def pred_article(start, end, name="דוד", type_="PERSON", acceptance="auto"):
    return {
        "source_kind": "article",
        "span_start": start,
        "span_end": end,
        "intended_name": name,
        "entity_type": type_,
        "acceptance": acceptance,
    }


class TestLoadGolden(unittest.TestCase):
    def write(self, payload):
        f = tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        )
        json.dump(payload, f)
        f.close()
        self.addCleanup(Path(f.name).unlink)
        return f.name

    def test_valid_payload(self):
        path = self.write(
            {"version": 1, "cases": [{"id": "c1", "mentions": []}]}
        )
        self.assertEqual(len(ge.load_golden(path)["cases"]), 1)

    def test_missing_cases_list_rejected(self):
        path = self.write({"version": 1})
        with self.assertRaises(ValueError):
            ge.load_golden(path)

    def test_wrong_version_rejected(self):
        path = self.write({"version": 2, "cases": []})
        with self.assertRaises(ValueError):
            ge.load_golden(path)

    def test_duplicate_case_ids_rejected(self):
        path = self.write(
            {
                "version": 1,
                "cases": [
                    {"id": "c1", "mentions": []},
                    {"id": "c1", "mentions": []},
                ],
            }
        )
        with self.assertRaises(ValueError):
            ge.load_golden(path)

    def test_mentions_must_be_a_list(self):
        path = self.write(
            {"version": 1, "cases": [{"id": "c1", "mentions": {}}]}
        )
        with self.assertRaises(ValueError):
            ge.load_golden(path)

    def test_unknown_mention_field_rejected(self):
        path = self.write(
            {
                "version": 1,
                "cases": [
                    {"id": "c1", "mentions": [{"name": "x", "bogus": 1}]}
                ],
            }
        )
        with self.assertRaises(ValueError):
            ge.load_golden(path)

    def test_missing_name_or_type_rejected(self):
        path = self.write(
            {"version": 1, "cases": [{"id": "c1", "mentions": [{"surface": "x"}]}]}
        )
        with self.assertRaises(ValueError):
            ge.load_golden(path)

    def test_missing_span_or_surface_rejected(self):
        path = self.write(
            {
                "version": 1,
                "cases": [
                    {
                        "id": "c1",
                        "mentions": [{"name": "x", "type": "PERSON"}],
                    }
                ],
            }
        )
        with self.assertRaises(ValueError):
            ge.load_golden(path)

    def test_mixed_domain_span_fields_rejected(self):
        path = self.write(
            {
                "version": 1,
                "cases": [
                    {
                        "id": "c1",
                        "mentions": [
                            {
                                "surface": "x",
                                "start": 0,
                                "name": "x",
                                "type": "PERSON",
                            }
                        ],
                    }
                ],
            }
        )
        with self.assertRaises(ValueError):
            ge.load_golden(path)

    def test_bad_expected_value_rejected(self):
        path = self.write(
            {
                "version": 1,
                "cases": [
                    {
                        "id": "c1",
                        "mentions": [
                            {"name": "x", "type": "PERSON", "expected": "maybe"}
                        ],
                    }
                ],
            }
        )
        with self.assertRaises(ValueError):
            ge.load_golden(path)


class TestResolvePasuk(unittest.TestCase):
    """Perek resolution over a minimal fake canonical structure."""

    def setUp(self):
        self.sefarim = [
            {
                "perakim": [
                    {"pesukim": [{"segments": []}]},
                    {"pesukim": [{"segments": []}]},
                ]
            },
            {
                "additionals": [
                    {"perakim": [{"pesukim": [{"segments": []}]}]},
                    {"perakim": [{"pesukim": [{"segments": []}]}]},
                ]
            },
        ]
        self.book_patch = mock.patch.dict(
            ge.baseline.SEFER_BOOKS, {0: ["X"], 1: ["Y", "Z"]}
        )
        self.book_patch.start()
        self.addCleanup(self.book_patch.stop)

    def test_plain_sefer_resolves_by_chapter(self):
        case = {"id": "c", "sefer": 0, "perek": 2, "pasuk": 1}
        perek, stem, chapter = ge.resolve_pasuk(case, self.sefarim)
        self.assertIs(perek, self.sefarim[0]["perakim"][1])
        self.assertEqual((stem, chapter), ("X", 2))

    def test_additional_selects_split_book(self):
        case = {"id": "c", "sefer": 1, "additional": 1, "perek": 1, "pasuk": 1}
        perek, stem, chapter = ge.resolve_pasuk(case, self.sefarim)
        self.assertIs(perek, self.sefarim[1]["additionals"][1]["perakim"][0])
        self.assertEqual((stem, chapter), ("Z", 1))

    def test_missing_chapter_raises(self):
        case = {"id": "c", "sefer": 0, "perek": 9, "pasuk": 1}
        with self.assertRaises(ValueError):
            ge.resolve_pasuk(case, self.sefarim)


class TestResolvePasukMentions(unittest.TestCase):
    def perek(self, values, types=None):
        types = types or ["qri"] * len(values)
        return {
            "pesukim": [
                {
                    "segments": [
                        {"value": v, "type": t}
                        for v, t in zip(values, types)
                    ]
                }
            ]
        }

    def case(self, mentions):
        return {"id": "c", "pasuk": 1, "mentions": mentions}

    def test_resolves_spans_and_validates_text(self):
        perek = self.perek(["וַיֹּ֤אמֶר", "יְהוָה֙", "אַבְרָ֔ם"])
        case = self.case(
            [
                {"start": 1, "end": 1, "text": "יהוה", "name": "יהוה",
                 "type": "PERSON"},
                {"start": 1, "end": 2, "text": "יהוה אברם", "name": "x",
                 "type": "PERSON"},
            ]
        )
        golds = ge.resolve_pasuk_mentions(case, perek)
        self.assertEqual([g["span"] for g in golds], [(1, 2), (1, 3)])

    def test_text_mismatch_raises(self):
        perek = self.perek(["אַבְרָ֔ם"])
        case = self.case(
            [{"start": 0, "end": 0, "text": "משה", "name": "x", "type": "PERSON"}]
        )
        with self.assertRaises(ValueError):
            ge.resolve_pasuk_mentions(case, perek)

    def test_zero_width_chars_are_ignored_in_text(self):
        # Ruth 1:2 has a ZWJ inside אלימלך in the canonical dump.
        perek = self.perek(["אֱ‍ֽלִימֶ֡לֶךְ"])
        case = self.case(
            [
                {"start": 0, "end": 0, "text": "אלימלך", "name": "x",
                 "type": "PERSON"}
            ]
        )
        self.assertEqual(len(ge.resolve_pasuk_mentions(case, perek)), 1)

    def test_out_of_range_span_raises(self):
        perek = self.perek(["א"])
        case = self.case(
            [{"start": 0, "end": 5, "text": "א", "name": "x", "type": "PERSON"}]
        )
        with self.assertRaises(ValueError):
            ge.resolve_pasuk_mentions(case, perek)

    def test_non_text_bearing_segment_raises(self):
        perek = self.perek(["א", "ס"], ["qri", "ptuha"])
        case = self.case(
            [{"start": 0, "end": 1, "text": "א ס", "name": "x", "type": "PERSON"}]
        )
        with self.assertRaises(ValueError):
            ge.resolve_pasuk_mentions(case, perek)


class TestResolveArticleMentions(unittest.TestCase):
    def test_resolves_utf16_span(self):
        case = {
            "id": "c",
            "content": "<p>abcאברם</p>",
            "mentions": [
                {"surface": "אברם", "name": "אברם", "type": "PERSON"}
            ],
        }
        golds = ge.resolve_article_mentions(case)
        self.assertEqual(golds[0]["span"], (6, 10))

    def test_astral_char_shifts_utf16_offsets(self):
        case = {
            "id": "c",
            "content": "<p>😀אברם</p>",
            "mentions": [
                {"surface": "אברם", "name": "אברם", "type": "PERSON"}
            ],
        }
        golds = ge.resolve_article_mentions(case)
        # 😀 is one code point but two UTF-16 units — offsets shift by one.
        self.assertEqual(golds[0]["span"], (5, 9))

    def test_occurrence_selects_nth_match(self):
        case = {
            "id": "c",
            "content": "<p>דוד ודוד</p>",
            "mentions": [
                {
                    "surface": "ודוד",
                    "name": "דוד",
                    "type": "PERSON",
                    "occurrence": 0,
                }
            ],
        }
        golds = ge.resolve_article_mentions(case)
        self.assertEqual(golds[0]["span"], (7, 11))

    def test_missing_surface_raises(self):
        case = {
            "id": "c",
            "content": "<p>דוד</p>",
            "mentions": [
                {"surface": "משה", "name": "משה", "type": "PERSON"}
            ],
        }
        with self.assertRaises(ValueError):
            ge.resolve_article_mentions(case)

    def test_occurrence_beyond_count_raises(self):
        case = {
            "id": "c",
            "content": "<p>דוד</p>",
            "mentions": [
                {"surface": "דוד", "name": "דוד", "type": "PERSON",
                 "occurrence": 1}
            ],
        }
        with self.assertRaises(ValueError):
            ge.resolve_article_mentions(case)

    def test_overlapping_gold_spans_rejected(self):
        case = {
            "id": "c",
            "content": "<p>אברם</p>",
            "mentions": [
                {"surface": "אברם", "name": "א", "type": "PERSON"},
                {"surface": "ברם", "name": "ב", "type": "PERSON"},
            ],
        }
        with self.assertRaises(ValueError):
            ge.resolve_article_mentions(case)

    def test_adjacent_gold_spans_are_allowed(self):
        case = {
            "id": "c",
            "content": "<p>אבגד</p>",
            "mentions": [
                {"surface": "אב", "name": "א", "type": "PERSON"},
                {"surface": "גד", "name": "ב", "type": "PERSON"},
            ],
        }
        self.assertEqual(len(ge.resolve_article_mentions(case)), 2)


class TestScoreCase(unittest.TestCase):
    def test_clean_auto_match_is_tp_with_hits(self):
        counts, partials = ge.score_case(
            [pred_pasuk(1, 1, type_="PLACE")], [gold((1, 2), type_="PLACE")]
        )
        self.assertEqual(counts["tp"], 1)
        self.assertEqual(counts["type_hit"], 1)
        self.assertEqual(counts["name_hit"], 1)
        self.assertEqual(partials, [])

    def test_name_alternates_count_flexibly_but_not_strictly(self):
        g = gold((1, 2), name="ירושלים", name_alternates=["ירושלם"])
        counts, _ = ge.score_case([pred_pasuk(1, 1, name="ירושלם")], [g])
        self.assertEqual(counts["name_hit"], 1)
        self.assertEqual(counts["name_strict_hit"], 0)

    def test_type_alternates_count_flexibly_but_not_strictly(self):
        g = gold((1, 2), type_="PLACE", type_alternates=["NATION"])
        counts, _ = ge.score_case([pred_pasuk(1, 1, type_="NATION")], [g])
        self.assertEqual(counts["type_hit"], 1)
        self.assertEqual(counts["type_strict_hit"], 0)

    def test_held_prediction_on_auto_gold_is_held_hit(self):
        counts, _ = ge.score_case(
            [pred_pasuk(1, 1, acceptance="held")], [gold((1, 2))]
        )
        self.assertEqual(counts["held_hit"], 1)
        self.assertEqual(counts["tp"], 0)

    def test_auto_prediction_on_held_gold_is_rendered_suppressed(self):
        counts, _ = ge.score_case(
            [pred_pasuk(1, 1)], [gold((1, 2), expected="held")]
        )
        self.assertEqual(counts["rendered_suppressed"], 1)
        self.assertEqual(counts["tp"], 0)

    def test_held_prediction_on_held_gold_is_correct(self):
        counts, _ = ge.score_case(
            [pred_pasuk(1, 1, acceptance="held")],
            [gold((1, 2), expected="held")],
        )
        self.assertEqual(counts["held_correct"], 1)

    def test_unmatched_predictions_and_golds(self):
        counts, _ = ge.score_case(
            [
                pred_pasuk(5, 5),
                pred_pasuk(7, 7, acceptance="held"),
            ],
            [gold((1, 2)), gold((3, 4), expected="held")],
        )
        self.assertEqual(counts["fp"], 1)
        self.assertEqual(counts["held_noise"], 1)
        self.assertEqual(counts["fn"], 1)
        self.assertEqual(counts["suppressed_ok"], 1)

    def test_partial_overlap_is_diagnostic_not_tp(self):
        counts, partials = ge.score_case(
            [pred_pasuk(1, 1)], [gold((1, 3))]
        )
        self.assertEqual(counts["tp"], 0)
        self.assertEqual(counts["fn"], 1)
        self.assertEqual(counts["fp"], 1)
        self.assertEqual(counts["partial"], 1)
        self.assertEqual(len(partials), 1)

    def test_one_pred_cannot_match_two_golds(self):
        counts, _ = ge.score_case(
            [pred_pasuk(1, 1)],
            [gold((1, 2), name="a"), gold((1, 2), name="b")],
        )
        self.assertEqual(counts["tp"], 1)
        self.assertEqual(counts["fn"], 1)

    def test_maqaf_article_spans_match_exactly(self):
        counts, _ = ge.score_case(
            [pred_article(5, 10)], [gold((5, 10))]
        )
        self.assertEqual(counts["tp"], 1)

    def test_gold_counters(self):
        counts, _ = ge.score_case(
            [], [gold((1, 2)), gold((3, 4), expected="held")]
        )
        self.assertEqual(counts["gold_auto"], 1)
        self.assertEqual(counts["gold_held"], 1)

    def test_manual_prediction_renders_like_auto(self):
        # The resolver renders acceptance IN ('auto','manual') — a manual
        # row on auto gold is a rendered true positive, not a held hit.
        counts, _ = ge.score_case(
            [pred_pasuk(1, 1, acceptance="manual")], [gold((1, 2))]
        )
        self.assertEqual(counts["tp"], 1)
        self.assertEqual(counts["held_hit"], 0)

    def test_manual_prediction_on_held_gold_is_rendered_suppressed(self):
        counts, _ = ge.score_case(
            [pred_pasuk(1, 1, acceptance="manual")],
            [gold((1, 2), expected="held")],
        )
        self.assertEqual(counts["rendered_suppressed"], 1)
        self.assertEqual(counts["held_correct"], 0)
        self.assertEqual(ge.finalize(counts)["suppression"], 0.0)

    def test_unmatched_manual_prediction_is_fp(self):
        counts, _ = ge.score_case(
            [pred_pasuk(5, 5, acceptance="manual")], []
        )
        self.assertEqual(counts["fp"], 1)
        self.assertEqual(counts["held_noise"], 0)

    def test_rejected_prediction_is_not_detection(self):
        # `rejected` asserts the span is NOT a mention: on auto gold the
        # miss surfaces as fn, never as a suppressed detection.
        counts, _ = ge.score_case(
            [pred_pasuk(1, 1, acceptance="rejected")], [gold((1, 2))]
        )
        self.assertEqual(counts["tp"], 0)
        self.assertEqual(counts["held_hit"], 0)
        self.assertEqual(counts["fn"], 1)
        self.assertEqual(counts["rejected"], 1)
        self.assertEqual(ge.finalize(counts)["detection_recall"], 0.0)

    def test_rejected_prediction_unmatched_is_diagnostic_only(self):
        counts, _ = ge.score_case(
            [pred_pasuk(5, 5, acceptance="rejected")], []
        )
        self.assertEqual(counts["rejected"], 1)
        self.assertEqual(counts["fp"], 0)
        self.assertEqual(counts["held_noise"], 0)

    def test_rendered_duplicate_wins_pairing_on_auto_gold(self):
        # held + auto rows at one span: the page renders the auto row,
        # so the pair must score tp regardless of emission order.
        for first, second in (("held", "auto"), ("auto", "held")):
            counts, _ = ge.score_case(
                [
                    pred_pasuk(1, 1, acceptance=first),
                    pred_pasuk(1, 1, acceptance=second),
                ],
                [gold((1, 2))],
            )
            self.assertEqual(counts["tp"], 1, (first, second))
            self.assertEqual(counts["held_hit"], 0, (first, second))
            self.assertEqual(counts["held_noise"], 1, (first, second))
            self.assertEqual(counts["fp"], 0, (first, second))

    def test_rendered_duplicate_wins_pairing_on_held_gold(self):
        # held + auto rows at a suppressed span: the auto row renders a
        # link the gold forbids — suppression must fail, not record
        # held_correct while the rendered row hides as a bare fp.
        for first, second in (("held", "auto"), ("auto", "held")):
            counts, _ = ge.score_case(
                [
                    pred_pasuk(1, 1, acceptance=first),
                    pred_pasuk(1, 1, acceptance=second),
                ],
                [gold((1, 2), expected="held")],
            )
            self.assertEqual(
                counts["rendered_suppressed"], 1, (first, second)
            )
            self.assertEqual(counts["held_correct"], 0, (first, second))
            self.assertEqual(
                ge.finalize(counts)["suppression"], 0.0, (first, second)
            )

    def test_unknown_acceptance_raises(self):
        with self.assertRaises(ValueError):
            ge.score_case(
                [pred_pasuk(1, 1, acceptance="maybe")], [gold((1, 2))]
            )


class TestFinalize(unittest.TestCase):
    def test_ratios(self):
        counts = collections.Counter(
            {
                "tp": 3,
                "fp": 1,
                "fn": 1,
                "gold_auto": 4,
                "type_hit": 2,
                "type_strict_hit": 1,
                "name_hit": 3,
                "name_strict_hit": 3,
                "held_hit": 0,
                "held_correct": 0,
                "rendered_suppressed": 0,
                "suppressed_ok": 0,
                "gold_held": 0,
                "partial": 0,
            }
        )
        m = ge.finalize(counts)
        self.assertEqual(m["precision"], 0.75)
        self.assertEqual(m["recall"], 0.75)
        self.assertEqual(m["f1"], 0.75)
        self.assertAlmostEqual(m["type_accuracy"], 2 / 3, places=6)
        self.assertAlmostEqual(m["type_accuracy_strict"], 1 / 3, places=6)
        self.assertEqual(m["span_exactness"], 1.0)
        self.assertIsNone(m["suppression"])

    def test_zero_denominators_yield_none(self):
        m = ge.finalize(collections.Counter())
        self.assertIsNone(m["precision"])
        self.assertIsNone(m["recall"])
        self.assertIsNone(m["f1"])

    def test_suppression_counts_emitted_and_unemitted(self):
        counts = collections.Counter(
            {"held_correct": 1, "suppressed_ok": 1, "rendered_suppressed": 1,
             "gold_held": 3}
        )
        self.assertAlmostEqual(
            ge.finalize(counts)["suppression"], 2 / 3, places=6
        )


class TestEvaluateArticlesStubbed(unittest.TestCase):
    """evaluate_articles with an injected predictor — no corpus needed."""

    def test_report_shape_and_counts(self):
        cases = [
            {
                "id": "c1",
                "categories": ["demo"],
                "article_id": 1,
                "content": "<p>אברם</p>",
                "mentions": [
                    {"surface": "אברם", "name": "אברם", "type": "PERSON"}
                ],
            },
            {
                "id": "c2",
                "categories": ["demo"],
                "article_id": 2,
                "content": "<p>דוד</p>",
                "mentions": [
                    {"surface": "דוד", "name": "דוד", "type": "PERSON"}
                ],
            },
        ]

        def predict(article_id, content):
            if article_id == 1:
                return [pred_article(3, 7, name="אברם")]
            return []

        report = ge.evaluate_articles(
            cases, predict=predict, model_revision="stub@1"
        )
        self.assertEqual(report["model_revision"], "stub@1")
        self.assertEqual(report["cases"], 2)
        self.assertEqual(report["predictions"], 1)
        self.assertEqual(report["metrics"]["precision"], 1.0)
        self.assertEqual(report["metrics"]["recall"], 0.5)
        self.assertEqual(report["per_category"]["demo"]["counts"]["fn"], 1)
        self.assertEqual(
            report["per_case"]["c1"]["metrics"]["precision"], 1.0
        )

    def test_partials_are_stored_per_case(self):
        cases = [
            {
                "id": "c1",
                "article_id": 1,
                "content": "<p>אברם אבינו</p>",
                "mentions": [
                    {
                        "surface": "אברם אבינו",
                        "name": "אברם אבינו",
                        "type": "PERSON",
                    }
                ],
            }
        ]

        def predict(aid, content):
            return [pred_article(3, 7, name="אברם")]

        report = ge.evaluate_articles(cases, predict=predict)
        self.assertEqual(report["counts"]["partial"], 1)
        self.assertEqual(report["counts"]["fn"], 1)


class TestEvaluatePasukStubbed(unittest.TestCase):
    def setUp(self):
        self.sefarim = [
            {
                "perakim": [
                    {
                        "pesukim": [
                            {
                                "segments": [
                                    {"value": "אַבְרָ֔ם", "type": "qri"},
                                    {"value": "דָּוִ֔ד", "type": "qri"},
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
        self.book_patch = mock.patch.dict(
            ge.baseline.SEFER_BOOKS, {0: ["X"]}
        )
        self.book_patch.start()
        self.addCleanup(self.book_patch.stop)

    def test_rows_filtered_by_pasuk_number(self):
        cases = [
            {
                "id": "c1",
                "sefer": 0,
                "perek": 1,
                "pasuk": 1,
                "mentions": [
                    {"start": 0, "end": 0, "text": "אברם", "name": "אברם",
                     "type": "PERSON"},
                    {"start": 1, "end": 1, "text": "דוד", "name": "דוד",
                     "type": "PERSON"},
                ],
            }
        ]

        def predict_with_numbers(perek, stem, chapter):
            return [
                {**pred_pasuk(0, 0, name="אברם"), "pasuk_number": 1},
                {**pred_pasuk(0, 0, name="x"), "pasuk_number": 2},
            ]

        report = ge.evaluate_pasuk(
            cases, self.sefarim, predict=predict_with_numbers,
            model_revision="stub@1",
        )
        self.assertEqual(report["predictions"], 1)
        self.assertEqual(report["counts"]["tp"], 1)
        self.assertEqual(report["counts"]["fn"], 1)


class TestDeterministic(unittest.TestCase):
    def test_drops_runtime(self):
        report = {"pasuk": {}, "article": {}, "runtime": {"x": 1}}
        self.assertEqual(ge.deterministic(report), {"pasuk": {}, "article": {}})


class TestClean(unittest.TestCase):
    def test_zero_width_removed(self):
        self.assertEqual(ge._clean("א\u200dב\u200bc"), "אבc")


if __name__ == "__main__":
    unittest.main()
