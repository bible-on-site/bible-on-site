"""Canonical surface alignment protects readers from source-version offsets."""

import unittest

import baseline
import baseline_articles


def perek(*words):
    return {"perekId": 1, "pesukim": [
        {"segments": [{"type": "qri", "value": word} for word in words]}
    ]}


def rows(source, *tokens):
    return baseline.decorations_for_perek(source, {"1": list(tokens)}, {})


class TestCanonicalAlignment(unittest.TestCase):
    def test_exact_source_surface_includes_prefix_and_diacritics(self):
        source = perek("וַיֵּלֶךְ", "וּלְאַבְרָם")
        result = rows(source, [1, "87", "וּ/לְ/אַבְרָם", "p"])
        self.assertEqual(result[0]["surface"], "וּלְאַבְרָם")
        self.assertEqual(result[0]["intended_name"], "אברם")

    def test_offset_is_recovered_only_when_surface_match_is_unique(self):
        result = rows(perek("שמע", "ישראל"), [0, "3478", "יִשְׂרָאֵל", "p"])
        self.assertEqual(result[0]["segment_start"], 1)
        self.assertEqual(result[0]["surface"], "ישראל")

    def test_wrong_word_is_never_annotated(self):
        self.assertEqual(rows(perek("אל", "העם"), [0, "4872", "מֹשֶׁה", "p"]), [])

    def test_ambiguous_relocation_abstains(self):
        self.assertEqual(rows(perek("אמר", "דוד", "דוד"), [0, "1732", "דָּוִד", "p"]), [])

    def test_out_of_bounds_unique_match_can_be_recovered(self):
        result = rows(perek("דוד"), [5, "1732", "דוד", "p"])
        self.assertEqual(result[0]["segment_start"], 0)

    def test_partial_compound_is_not_emitted(self):
        self.assertEqual(rows(perek("בית", "אמר"),
                              [0, "1008+", "בית", "p"], [1, "410", "אל", "p"]), [])

    def test_compound_cannot_swallow_an_intervening_word(self):
        self.assertEqual(rows(perek("בית", "אמר", "אל"),
                              [0, "1008+", "בית", "p"], [1, "410", "אל", "p"]), [])

    def test_relocation_cannot_reuse_a_confirmed_span(self):
        result = rows(perek("דוד", "אמר"), [0, "1732", "דוד", "p"], [1, "1732", "דוד", "p"])
        self.assertEqual(len(result), 1)

    def test_qri_ktiv_different_spelling_is_not_fuzzy_matched(self):
        self.assertEqual(rows(perek("צביים"), [0, "6636", "צבוים", "p"]), [])


class TestIntendedNameNormalization(unittest.TestCase):
    def test_directional_suffix_is_removed_and_final_letter_restored(self):
        result = rows(perek("מִצְרַיְמָה"), [0, "4714", "מִצְרַיְמָ/ה", "p"])
        self.assertEqual(result[0]["intended_name"], "מצרים")
        self.assertEqual(result[0]["surface"], "מִצְרַיְמָה")
        self.assertEqual(result[0]["acceptance"], "auto")

    def test_zero_width_characters_do_not_leak_into_name(self):
        result = rows(perek("אֱ\u200dלִימֶלֶךְ"), [0, "458", "אֱ\u200dלִימֶלֶךְ", "p"])
        self.assertEqual(result[0]["intended_name"], "אלימלך")
        self.assertIn("\u200d", result[0]["surface"])

    def test_attested_lemma_form_beats_an_inflected_stem(self):
        lexicon = {"books": {"Dan": {"1": {"1": [
            [0, "3779", "כַּשְׂדִּים", "g"],
            [1, "3779", "כַּשְׂדָּ/י", "g"],
        ]}}}}
        result = baseline.decorations_for_perek(
            perek("כַּשְׂדָּי"), {"1": [[0, "3779", "כַּשְׂדָּ/י", "g"]]}, lexicon
        )
        self.assertEqual(result[0]["intended_name"], "כשדים")
        self.assertEqual(result[0]["acceptance"], "auto")

    def test_unattested_non_directional_suffix_is_held(self):
        result = rows(perek("עדינו"), [0, "5722", "עדינ/ו", "p"])
        self.assertEqual(result[0]["intended_name"], "עדין")
        self.assertEqual(result[0]["acceptance"], "held")

    def test_tied_attested_spellings_do_not_choose_arbitrarily(self):
        lexicon = {"books": {"X": {"1": {"1": [
            [0, "1", "אב", "p"], [1, "1", "אבא", "p"],
        ]}}}}
        self.assertNotIn("1", baseline.preferred_lemma_names(lexicon))

    def test_prefixes_and_suffixes_are_both_removed(self):
        name, uncertain = baseline.intended_token_name(
            [0, "l/4714", "וּ/לְ/מִצְרַיְמָ/ה", "p"], {}
        )
        self.assertEqual(name, "מצרים")
        self.assertFalse(uncertain)

    def test_uncertain_source_name_stays_held_in_article_gazetteer(self):
        source = rows(perek("עדינו"), [0, "5722", "עדינ/ו", "p"])
        held = baseline_articles.held_names(source, {})
        article = baseline_articles.decorations_for_article(
            1, "<p>עדין</p>", baseline_articles.build_gazetteer(source), held
        )
        self.assertEqual(article[0]["acceptance"], "held")

    def test_attested_manual_or_auto_name_is_not_held_only_by_other_uncertainty(self):
        uncertain = {"intended_name": "עדין", "entity_type": "PERSON", "acceptance": "held"}
        for acceptance in ("auto", "manual"):
            with self.subTest(acceptance=acceptance):
                confirmed = dict(uncertain, acceptance=acceptance)
                self.assertNotIn("עדין", baseline_articles.held_names([uncertain, confirmed], {}))


if __name__ == "__main__":
    unittest.main()
