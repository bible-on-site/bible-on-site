"""Unit tests for the article-domain lexical baseline (issue #2516)."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import baseline_articles as ba


def make_gazetteer():
    return {
        "אברם": "PERSON",
        "אברם אבינו": "PERSON",
        "בית אל": "PLACE",
        "מצרים": "NATION",
        "יהוה": "PERSON",
    }


class TestIterTextRuns(unittest.TestCase):
    def test_plain_text_is_one_run(self):
        self.assertEqual(list(ba.iter_text_runs("abc")), [(0, 3)])

    def test_tag_boundaries_split_runs(self):
        html = "<p>one</p><p>two</p>"
        runs = list(ba.iter_text_runs(html))
        self.assertEqual([html[s:e] for s, e in runs], ["one", "two"])
        self.assertEqual(runs, [(3, 6), (13, 16)])

    def test_anchor_interior_is_skipped(self):
        html = "pre <a href='/x'>inside</a> post"
        runs = list(ba.iter_text_runs(html))
        self.assertEqual([html[s:e] for s, e in runs], ["pre ", " post"])

    def test_script_and_style_interiors_are_skipped(self):
        html = "a<script>skip</script>b<style>skip</style>c"
        runs = list(ba.iter_text_runs(html))
        self.assertEqual([html[s:e] for s, e in runs], ["a", "b", "c"])

    def test_nested_skip_tags_resume_at_outermost_close(self):
        html = "a<a><a>deep</a>still</a>b"
        runs = list(ba.iter_text_runs(html))
        self.assertEqual([html[s:e] for s, e in runs], ["a", "b"])

    def test_comment_does_not_open_a_skip_zone(self):
        html = "a<!-- <a> -->&amp;<a>x</a>b"
        runs = list(ba.iter_text_runs(html))
        self.assertEqual([html[s:e] for s, e in runs], ["a", "&amp;", "b"])

    def test_quoted_attribute_gt_does_not_end_tag(self):
        html = "<a title='1>2'>x</a>y"
        runs = list(ba.iter_text_runs(html))
        self.assertEqual([html[s:e] for s, e in runs], ["y"])

    def test_self_closing_anchor_does_not_skip_rest(self):
        html = "a<a/>b"
        runs = list(ba.iter_text_runs(html))
        self.assertEqual([html[s:e] for s, e in runs], ["a", "b"])

    def test_unclosed_skip_tag_suppresses_trailing_text(self):
        runs = list(ba.iter_text_runs("a<script>b"))
        self.assertEqual(["a<script>b"[s:e] for s, e in runs], ["a"])


class TestRunWords(unittest.TestCase):
    def test_hebrew_words_with_raw_offsets(self):
        html = "abאברם cd"
        words = list(ba.run_words(html, 0, len(html)))
        self.assertEqual([(w[2], html[w[0]:w[1]]) for w in words], [("אברם", "אברם")])
        self.assertEqual(words[0][:2], (2, 6))

    def test_maqaf_splits_into_separate_words(self):
        html = "בית־אל"
        words = list(ba.run_words(html, 0, len(html)))
        self.assertEqual([w[2] for w in words], ["בית", "אל"])
        self.assertEqual(html[words[1][0] : words[1][1]], "אל")

    def test_diacritics_are_stripped_for_matching(self):
        html = "יְהוָה֙"
        words = list(ba.run_words(html, 0, len(html)))
        self.assertEqual(words[0][2], "יהוה")

    def test_non_hebrew_runs_yield_nothing(self):
        self.assertEqual(list(ba.run_words("<b>&nbsp;</b>", 0, 13)), [])


class TestPrefixVariants(unittest.TestCase):
    def test_identity_then_progressive_strips(self):
        self.assertEqual(list(ba.prefix_variants("ובאברם")), ["ובאברם", "באברם", "אברם"])

    def test_stops_at_minimum_length(self):
        self.assertEqual(list(ba.prefix_variants("אל")), ["אל"])
        self.assertEqual(list(ba.prefix_variants("באל")), ["באל", "אל"])

    def test_only_prefix_letters_strip(self):
        self.assertEqual(list(ba.prefix_variants("תאום")), ["תאום"])


class TestBuildGazetteer(unittest.TestCase):
    def test_majority_type_wins(self):
        rows = [
            {"intended_name": "מצרים", "entity_type": "PERSON"},
            {"intended_name": "מצרים", "entity_type": "NATION"},
            {"intended_name": "מצרים", "entity_type": "NATION"},
        ]
        self.assertEqual(ba.build_gazetteer(rows), {"מצרים": "NATION"})

    def test_single_letter_names_are_dropped(self):
        rows = [{"intended_name": "ב", "entity_type": "PERSON"}]
        self.assertEqual(ba.build_gazetteer(rows), {})

    def test_deterministic_tie_break(self):
        rows = [
            {"intended_name": "עיר", "entity_type": "PERSON"},
            {"intended_name": "עיר", "entity_type": "PLACE"},
        ]
        # Ties resolve alphabetically for reproducibility.
        self.assertEqual(ba.build_gazetteer(rows * 2), {"עיר": "PLACE"})


class TestHeldNames(unittest.TestCase):
    def test_homographs_are_held_and_pure_names_stay_auto(self):
        decorations = [
            {"intended_name": "מלך", "entity_type": "PERSON"},
            {"intended_name": "מלך", "entity_type": "PERSON"},
            {"intended_name": "דוד", "entity_type": "PERSON"},
            {"intended_name": "דוד", "entity_type": "PERSON"},
            {"intended_name": "דוד", "entity_type": "PERSON"},
        ]
        # מלך appears as an ordinary word far more than as a name.
        counts = {"מלך": 100, "דוד": 3}
        self.assertEqual(ba.held_names(decorations, counts), {"מלך"})

    def test_multi_word_names_are_never_held(self):
        decorations = [{"intended_name": "בית אל", "entity_type": "PLACE"}]
        counts = {"בית אל": 999, "בית": 9999}
        self.assertEqual(ba.held_names(decorations, counts), set())

    def test_single_letter_names_are_ignored(self):
        decorations = [{"intended_name": "ב", "entity_type": "PERSON"}]
        self.assertEqual(ba.held_names(decorations, {"ב": 99}), set())


class TestDecorationsForArticle(unittest.TestCase):
    def setUp(self):
        self.gazetteer = make_gazetteer()

    def test_direct_single_word_match(self):
        html = "<p>מצרים גדולה</p>"
        rows = ba.decorations_for_article(5, html, self.gazetteer)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(html[row["span_start"] : row["span_end"]], "מצרים")
        self.assertEqual(row["surface"], "מצרים")
        self.assertEqual(row["entity_type"], "NATION")
        self.assertEqual(row["source_kind"], "article")
        self.assertEqual(row["article_id"], 5)
        self.assertEqual(row["acceptance"], "auto")
        self.assertEqual(row["model_revision"], ba.MODEL_REVISION)

    def test_content_hash_is_sha256_of_stored_content(self):
        html = "<p>אברם</p>"
        rows = ba.decorations_for_article(1, html, self.gazetteer)
        digest = hashlib.sha256(html.encode("utf-8")).hexdigest()
        self.assertEqual(rows[0]["content_hash"], digest)
        self.assertEqual(rows[0]["source_hash"], digest)

    def test_fused_prefix_is_decorated_with_the_word(self):
        html = "<p>אמר לאברם לך</p>"
        rows = ba.decorations_for_article(1, html, self.gazetteer)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["surface"], "לאברם")
        self.assertEqual(rows[0]["intended_name"], "אברם")

    def test_double_prefix_strips(self):
        html = "<p>ובאברם</p>"
        rows = ba.decorations_for_article(1, html, self.gazetteer)
        self.assertEqual(rows[0]["surface"], "ובאברם")
        self.assertEqual(rows[0]["intended_name"], "אברם")

    def test_longest_match_wins_over_shorter_name(self):
        html = "<p>אמר אברם אבינו כך</p>"
        rows = ba.decorations_for_article(1, html, self.gazetteer)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["surface"], "אברם אבינו")
        self.assertEqual(rows[0]["intended_name"], "אברם אבינו")

    def test_maqaf_joined_name_matches_with_exact_span(self):
        html = "<p>לבית־אל הלך</p>"
        rows = ba.decorations_for_article(1, html, self.gazetteer)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["surface"], "לבית־אל")
        self.assertEqual(rows[0]["intended_name"], "בית אל")

    def test_anchor_interior_is_never_decorated(self):
        html = "<p><a href='/929/1'>אברם</a> אמר</p>"
        self.assertEqual(ba.decorations_for_article(1, html, self.gazetteer), [])

    def test_script_interior_is_never_decorated(self):
        html = "<p>א</p><script>אברם</script>"
        self.assertEqual(ba.decorations_for_article(1, html, self.gazetteer), [])

    def test_ordinary_words_emit_nothing(self):
        html = "<p>הלך אל המקום ושב</p>"
        self.assertEqual(ba.decorations_for_article(1, html, self.gazetteer), [])

    def test_vocalized_quoted_pasuk_still_matches(self):
        html = "<p>כמו שנאמר: יְהוָה֙ אָמַר</p>"
        rows = ba.decorations_for_article(1, html, self.gazetteer)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["intended_name"], "יהוה")
        # The span keeps the exact vocalized surface.
        self.assertEqual(rows[0]["surface"], "יְהוָה֙")

    def test_multiple_names_in_one_run(self):
        html = "<p>אברם ומצרים פגשו בבית אל</p>"
        rows = ba.decorations_for_article(1, html, self.gazetteer)
        self.assertEqual(
            [r["intended_name"] for r in rows], ["אברם", "מצרים", "בית אל"]
        )

    def test_spans_are_exact_raw_offsets(self):
        html = "<div><b>אמר</b> לאברם: <i>צא</i> מבית אל</div>"
        rows = ba.decorations_for_article(2, html, self.gazetteer)
        for row in rows:
            self.assertEqual(
                html[row["span_start"] : row["span_end"]], row["surface"]
            )

    def test_empty_content(self):
        self.assertEqual(ba.decorations_for_article(1, "", self.gazetteer), [])

    def test_astral_chars_emit_utf16_offsets(self):
        # The render side slices by UTF-16 units: an astral emoji before
        # the mention shifts the stored span by one extra unit while
        # `surface` keeps the exact source substring.
        html = "<p>😀 אברם</p>"
        rows = ba.decorations_for_article(1, html, {"אברם": "PERSON"})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["surface"], "אברם")
        self.assertEqual(rows[0]["span_start"], html.index("אברם") + 1)
        self.assertEqual(rows[0]["span_end"], html.index("אברם") + 1 + 4)

    def test_sentence_punctuation_blocks_multiword_names(self):
        html = "<p>בית. אל הגיע</p>"
        rows = ba.decorations_for_article(1, html, {"בית אל": "PLACE"})
        self.assertEqual(rows, [])

    def test_maqaf_and_hyphen_gaps_still_join_multiword_names(self):
        gazetteer = {"בית אל": "PLACE"}
        for html in ("<p>בית־אל הגיע</p>", "<p>בית-אל הגיע</p>"):
            rows = ba.decorations_for_article(1, html, gazetteer)
            self.assertEqual(len(rows), 1, html)
            self.assertEqual(rows[0]["intended_name"], "בית אל")

    def test_blocked_long_match_falls_back_to_shorter_name(self):
        # "אברם. אבינו" must not join, but the real name אברם alone wins.
        html = "<p>אברם. אבינו</p>"
        rows = ba.decorations_for_article(
            1, html, {"אברם": "PERSON", "אברם אבינו": "PERSON"}
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["intended_name"], "אברם")
        self.assertEqual(rows[0]["surface"], "אברם")

    def test_stripped_match_dominated_by_ordinary_usage_is_held(self):
        # היה -> יה: fused-prefix stripping manufactures a name match out
        # of an ordinary word; surface dominance keeps it triageable only.
        gazetteer = {"יה": "PERSON"}
        rows = ba.decorations_for_article(
            1,
            "<p>היה הדבר</p>",
            gazetteer,
            word_counts={"היה": 3600},
            tagged_counts={"יה": 5},
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["intended_name"], "יה")
        self.assertEqual(rows[0]["surface"], "היה")
        self.assertEqual(rows[0]["acceptance"], "held")

    def test_unstripped_match_ignores_surface_dominance(self):
        # A direct name match stays auto even when the same surface word
        # is also common — phrase-level `held` covers that case instead.
        gazetteer = {"ישראל": "PERSON"}
        rows = ba.decorations_for_article(
            1,
            "<p>ישראל שמע</p>",
            gazetteer,
            word_counts={"ישראל": 2500},
            tagged_counts={"ישראל": 600},
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["acceptance"], "auto")

    def test_held_names_emit_held_rows(self):
        html = "<p>אמר מלך ואמר דוד</p>"
        gazetteer = {**self.gazetteer, "מלך": "PERSON", "דוד": "PERSON"}
        rows = ba.decorations_for_article(1, html, gazetteer, held={"מלך"})
        self.assertEqual([r["surface"] for r in rows], ["מלך", "דוד"])
        self.assertEqual(rows[0]["acceptance"], "held")
        self.assertEqual(rows[1]["acceptance"], "auto")


class TestLoadArticles(unittest.TestCase):
    def test_parses_id_and_content_and_skips_empty(self):
        payload = [
            {"id": 1, "content": "<p>x</p>"},
            {"id": 2, "content": None},
            {"id": 3, "content": ""},
        ]
        with tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(payload, f)
            f.flush()
            path = f.name
        try:
            self.assertEqual(ba.load_articles(path), [(1, "<p>x</p>")])
        finally:
            Path(path).unlink()

    def test_rejects_non_list_payload(self):
        with tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump({"id": 1}, f)
            f.flush()
            path = f.name
        try:
            with self.assertRaises(ValueError):
                ba.load_articles(path)
        finally:
            Path(path).unlink()


if __name__ == "__main__":
    unittest.main()
