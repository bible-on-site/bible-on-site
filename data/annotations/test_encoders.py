"""Unit tests for the encoder adapter (issue #2516).

No torch/transformers needed: every encoder-dependent function takes an
`entities_fn(text) -> [entity dicts]` callable, so the tests inject
canned pipeline outputs and exercise the pure adapter logic — matching
views, span snapping, name normalization, and acceptance gating.
"""

import unittest
import unittest.mock

import encoders

mock = unittest.mock


def fake_entities(*entities):
    """entities_fn stub: canned (label, start, end, score) outputs."""

    def entities_fn(text):
        return [
            {"entity_group": label, "score": score, "start": start, "end": end}
            for label, start, end, score in entities
        ]

    return entities_fn


def pasuk(values, types=None):
    types = types or ["qri"] * len(values)
    return {
        "segments": [
            {"value": v, "type": t} for v, t in zip(values, types)
        ]
    }


NAMES = {"אברם", "מצרים", "כנעני", "בית אל", "לוט", "יהודה", "דוד", "אור כשדים"}


class TestNormalizedRun(unittest.TestCase):
    def test_plain_words_map_back(self):
        norm, words = encoders.normalized_run("אמר דוד הלך", 0, 11)
        self.assertEqual(norm, "אמר דוד הלך")
        self.assertEqual(words, [(0, 3, 0, 3), (4, 7, 4, 7), (8, 11, 8, 11)])

    def test_diacritics_stripped_positions_shift(self):
        norm, words = encoders.normalized_run("אַבְרָ֔ם", 0, 8)
        self.assertEqual(norm, "אברם")
        self.assertEqual(words, [(0, 8, 0, 4)])

    def test_gershayim_merges_acronym(self):
        norm, words = encoders.normalized_run('רש"י מפרש', 0, 9)
        self.assertEqual(norm, "רשי מפרש")
        # רש and י are separate source words but adjacent in the view.
        self.assertEqual(words[0][:2], (0, 2))
        self.assertEqual(words[1][:2], (3, 4))
        self.assertEqual(words[1][2:], (2, 3))

    def test_maqaf_renders_as_space(self):
        norm, words = encoders.normalized_run("לבית־אל", 0, 7)
        self.assertEqual(norm, "לבית אל")
        self.assertEqual(len(words), 2)

    def test_offsets_inside_larger_content(self):
        norm, words = encoders.normalized_run("<p>דוד שלום</p>", 3, 11)
        self.assertEqual(norm, "דוד שלום")
        self.assertEqual(words[0], (3, 6, 0, 3))


class TestPasukView(unittest.TestCase):
    def test_segment_granularity_and_types(self):
        p = pasuk(
            ["וַיֹּ֩אמֶר֩", "ס", "דָּוִ֔ד"],
            ["qri", "ptuha", "qri"],
        )
        norm, words = encoders.pasuk_view(p)
        self.assertEqual(norm, "ויאמר דוד")
        self.assertEqual(words, [(0, 0, 5), (2, 6, 9)])

    def test_maqaf_segment_stays_one_word(self):
        norm, words = encoders.pasuk_view(pasuk(["עַל־יָד֖וֹ"]))
        self.assertEqual(norm, "על ידו")
        self.assertEqual(words, [(0, 0, 6)])

    def test_empty_segments_are_skipped(self):
        norm, words = encoders.pasuk_view(
            pasuk(["פֶּ֖רֶךְ", "", "דָּוִ֔ד"], ["qri", "qri", "qri"])
        )
        self.assertEqual(norm, "פרך דוד")
        self.assertEqual([w[0] for w in words], [0, 2])


class TestEntityLabel(unittest.TestCase):
    def test_group_and_bio_forms(self):
        self.assertEqual(encoders.entity_label({"entity_group": "PER"}), "PER")
        self.assertEqual(encoders.entity_label({"entity": "B-LOC"}), "LOC")
        self.assertEqual(encoders.entity_label({"label": "I-GPE"}), "GPE")
        self.assertEqual(encoders.entity_label({}), "")


class TestClassifyWords(unittest.TestCase):
    def test_entity_maps_to_covered_words(self):
        norm, words = encoders.normalized_run("ויאמר אברם אל לוט", 0, 17)
        entities = fake_entities(("PER", 6, 10, 0.99))
        out = list(encoders.classify_words(norm, words, entities))
        self.assertEqual(out, [(1, 1, "PER", 0.99)])

    def test_mid_word_entity_snaps_to_word(self):
        # 'שביה' inside 'שביהודה' snaps to the whole word's index.
        norm, words = encoders.normalized_run("שביהודה", 0, 7)
        entities = fake_entities(("LOC", 1, 4, 0.9))
        out = list(encoders.classify_words(norm, words, entities))
        self.assertEqual(out, [(0, 0, "LOC", 0.9)])

    def test_entity_spanning_words(self):
        norm, words = encoders.normalized_run("בית אל היה", 0, 10)
        entities = fake_entities(("LOC", 0, 6, 0.9))
        out = list(encoders.classify_words(norm, words, entities))
        self.assertEqual(out, [(0, 1, "LOC", 0.9)])

    def test_chunking_splits_long_views(self):
        norm, words = encoders.normalized_run("א ב ג ד ה", 0, 9)
        calls = []

        def entities_fn(text):
            calls.append(text)
            return []

        with mock.patch.object(encoders, "MAX_CHUNK_WORDS", 2):
            list(encoders.classify_words(norm, words, entities_fn))
        self.assertEqual(calls, ["א ב", "ג ד", "ה"])

    def test_out_of_range_entity_is_dropped(self):
        norm, words = encoders.normalized_run("אב", 0, 2)
        out = list(
            encoders.classify_words(norm, words, fake_entities(("PER", 9, 12, 0.9)))
        )
        self.assertEqual(out, [])


class TestIntendedName(unittest.TestCase):
    def test_known_name_kept_unstripped(self):
        self.assertEqual(encoders.intended_name("לוט", NAMES), ("לוט", None))

    def test_prefix_stripped_to_known_name(self):
        self.assertEqual(
            encoders.intended_name("ומצרים", NAMES), ("מצרים", "ומצרים")
        )

    def test_double_prefix_strips_deepest_hit(self):
        self.assertEqual(
            encoders.intended_name("והכנעני", NAMES), ("כנעני", "והכנעני")
        )

    def test_name_letters_never_stripped(self):
        # כנען/הרן start with prefix letters but stay whole.
        self.assertEqual(
            encoders.intended_name("כנען", NAMES | {"כנען"}), ("כנען", None)
        )
        self.assertEqual(
            encoders.intended_name("הרן", NAMES), ("הרן", None)
        )

    def test_multiword_first_word_strip(self):
        self.assertEqual(
            encoders.intended_name("באור כשדים", NAMES),
            ("אור כשדים", "באור"),
        )

    def test_unknown_name_emitted_unstripped(self):
        self.assertEqual(encoders.intended_name("רשי", NAMES), ("רשי", None))


class TestDecorationsForPasuk(unittest.TestCase):
    def p(self):
        return pasuk(["וַיֵּלֶךְ", "אַבְרָ֔ם", "אֶל־ל֑וֹט"])

    def test_contract_row_shape_and_span(self):
        entities = fake_entities(("PER", 5, 9, 0.99))  # אברם in norm coords
        rows = encoders.decorations_for_pasuk(
            self.p(), 1, 42, entities, NAMES, model_revision="enc@1"
        )
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["source_kind"], "pasuk")
        self.assertEqual(row["perek_id"], 42)
        self.assertEqual(row["pasuk_number"], 1)
        self.assertEqual((row["segment_start"], row["segment_end"]), (1, 1))
        self.assertEqual(row["surface"], "אַבְרָ֔ם")  # raw, vowels intact
        self.assertEqual(row["intended_name"], "אברם")
        self.assertEqual(row["entity_type"], "PERSON")
        self.assertEqual(row["acceptance"], "auto")
        self.assertEqual(row["model_revision"], "enc@1")
        self.assertEqual(len(row["source_hash"]), 64)

    def test_unmapped_label_abstains(self):
        entities = fake_entities(("TIMEX", 5, 9, 0.99))
        rows = encoders.decorations_for_pasuk(
            self.p(), 1, 1, entities, NAMES
        )
        self.assertEqual(rows, [])

    def test_low_confidence_is_held(self):
        entities = fake_entities(("PER", 5, 9, 0.2))
        rows = encoders.decorations_for_pasuk(
            self.p(), 1, 1, entities, NAMES
        )
        self.assertEqual(rows[0]["acceptance"], "held")

    def test_held_name_suppresses(self):
        entities = fake_entities(("PER", 5, 9, 0.99))
        rows = encoders.decorations_for_pasuk(
            self.p(), 1, 1, entities, NAMES, held={"אברם"}
        )
        self.assertEqual(rows[0]["acceptance"], "held")

    def test_overlapping_span_rows_deduped(self):
        entities = fake_entities(("PER", 5, 9, 0.9), ("LOC", 5, 16, 0.8))
        rows = encoders.decorations_for_pasuk(
            self.p(), 1, 1, entities, NAMES
        )
        self.assertEqual(len(rows), 1)


class TestDecorationsForPerek(unittest.TestCase):
    def test_rows_carry_pasuk_numbers(self):
        perek = {
            "perekId": 7,
            "pesukim": [
                pasuk(["אַבְרָ֔ם"]),
                pasuk(["דָּוִ֔ד"]),
            ],
        }
        entities = fake_entities(("PER", 0, 4, 0.9))
        rows = encoders.decorations_for_perek(
            perek, entities, NAMES | {"אברם", "דוד"}, model_revision="r"
        )
        self.assertEqual([r["pasuk_number"] for r in rows], [1, 2])
        self.assertEqual(rows[0]["perek_id"], 7)


class TestDecorationsForArticle(unittest.TestCase):
    def test_span_offsets_and_surface(self):
        content = "<p>אמר דוד שלום</p>"
        # דוד sits at cp [7,11); norm coords identical here.
        entities = fake_entities(("PER", 4, 7, 0.99))
        rows = encoders.decorations_for_article(
            5, content, entities, NAMES, model_revision="enc@1"
        )
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["source_kind"], "article")
        self.assertEqual(row["article_id"], 5)
        self.assertEqual((row["span_start"], row["span_end"]), (7, 10))
        self.assertEqual(row["surface"], "דוד")
        self.assertEqual(row["intended_name"], "דוד")
        self.assertEqual(len(row["content_hash"]), 64)

    def test_astral_chars_shift_utf16_offsets(self):
        content = "<p>😀 אמר דוד</p>"
        entities = fake_entities(("PER", 5, 8, 0.99))
        rows = encoders.decorations_for_article(
            1, content, entities, NAMES
        )
        row = rows[0]
        self.assertEqual(row["surface"], "דוד")
        # 😀 = 2 UTF-16 units: דוד cp [9,12) -> utf16 [10,13).
        self.assertEqual((row["span_start"], row["span_end"]), (10, 13))

    def test_anchor_interior_not_classified(self):
        content = "<p>pre <a href='/x'>אברם</a> post</p>"
        seen = []

        def entities_fn(text):
            seen.append(text)
            return []

        encoders.decorations_for_article(1, content, entities_fn, NAMES)
        self.assertFalse(any("אברם" in text for text in seen))

    def test_prefix_stripped_name(self):
        content = "<p>נסע האיש להרן</p>"
        # 'להרן' norm [9,13): strip ל via gazetteer -> הרן.
        entities = fake_entities(("PER", 9, 13, 0.99))
        rows = encoders.decorations_for_article(
            1, content, entities, NAMES | {"הרן"}
        )
        self.assertEqual(rows[0]["intended_name"], "הרן")
        self.assertEqual(rows[0]["surface"], "להרן")
        self.assertEqual(rows[0]["acceptance"], "auto")

    def test_dominated_strip_is_held(self):
        # 'האל' -> 'אל': ordinary-word usage dominates the tagged count.
        content = "<p>אמר האל דוד</p>"
        entities = fake_entities(("PER", 4, 7, 0.99))
        rows = encoders.decorations_for_article(
            1,
            content,
            entities,
            {"אל"},
            word_counts={"האל": 1000},
            tagged_counts={"אל": 5},
        )
        self.assertEqual(rows[0]["intended_name"], "אל")
        self.assertEqual(rows[0]["acceptance"], "held")

    def test_multiword_name(self):
        content = "<p>עלה אברם לבית אל</p>"
        entities = fake_entities(("LOC", 9, 16, 0.99))
        rows = encoders.decorations_for_article(
            1, content, entities, NAMES
        )
        self.assertEqual(rows[0]["intended_name"], "בית אל")
        self.assertEqual(rows[0]["entity_type"], "PLACE")
        self.assertEqual(rows[0]["surface"], "לבית אל")


class TestWordEntityTypes(unittest.TestCase):
    def test_word_labels(self):
        norm, words = encoders.normalized_run("אמר דוד", 0, 7)
        types = encoders.word_entity_types(
            norm, words, fake_entities(("PER", 4, 7, 0.9))
        )
        self.assertEqual(types, {1: "PERSON"})

    def test_unmapped_labels_yield_no_type(self):
        norm, words = encoders.normalized_run("אמר דוד", 0, 7)
        types = encoders.word_entity_types(
            norm, words, fake_entities(("TIMEX", 4, 7, 0.9))
        )
        self.assertEqual(types, {})


class TestRetype(unittest.TestCase):
    def base_row(self, start, end):
        return {
            "source_kind": "pasuk",
            "segment_start": start,
            "segment_end": end,
            "intended_name": "x",
            "entity_type": "PERSON",
            "acceptance": "auto",
        }

    def test_pasuk_row_retyped_by_covered_words(self):
        p = pasuk(["אַבְרָ֔ם", "שְׁכֶ֖ם"])
        entities = fake_entities(("GPE", 5, 8, 0.9))  # שכם
        rows = encoders.retype_pasuk_rows(
            p, [self.base_row(0, 0), self.base_row(1, 1)], entities
        )
        self.assertEqual(rows[0]["entity_type"], "PERSON")  # abstain keeps
        self.assertEqual(rows[1]["entity_type"], "PLACE")   # GPE -> PLACE

    def test_pasuk_multiword_row_uses_mode(self):
        p = pasuk(["בֵּֽית־אֵ֖ל", "יָשָׁ֑ב"])
        entities = fake_entities(("LOC", 0, 6, 0.9))  # בית אל
        rows = encoders.retype_pasuk_rows(
            p, [self.base_row(0, 0)], entities
        )
        self.assertEqual(rows[0]["entity_type"], "PLACE")

    def test_article_row_retyped_by_span_overlap(self):
        content = "<p>נסע לשכם וישב</p>"
        entities = fake_entities(("GPE", 4, 8, 0.9))  # שכם inside לשכם
        rows = [
            {
                "source_kind": "article",
                "span_start": 7,
                "span_end": 11,
                "entity_type": "PERSON",
            }
        ]
        out = encoders.retype_article_rows(content, rows, entities)
        self.assertEqual(out[0]["entity_type"], "PLACE")

    def test_article_row_without_type_keeps_original(self):
        content = "<p>דוד אמר</p>"
        out = encoders.retype_article_rows(
            content,
            [{"source_kind": "article", "span_start": 3, "span_end": 6,
              "entity_type": "PERSON"}],
            fake_entities(),
        )
        self.assertEqual(out[0]["entity_type"], "PERSON")


class TestCandidateRegistry(unittest.TestCase):
    def test_specs_are_pinned_and_licensed(self):
        names = [s["name"] for s in encoders.CANDIDATES]
        self.assertEqual(len(names), len(set(names)))
        for spec in encoders.CANDIDATES:
            self.assertRegex(spec["revision"], r"^[0-9a-f]{40}$")
            self.assertTrue(spec["license"], spec["name"])
            self.assertTrue(spec["note"], spec["name"])
            if spec.get("runnable", True):
                self.assertEqual(spec["kind"], "token-classification")
        by_name = {s["name"]: s for s in encoders.CANDIDATES}
        # BEREL: clean license but fill-mask only — recorded, not runnable.
        self.assertFalse(by_name["berel"].get("runnable", True))
        self.assertEqual(by_name["berel"]["license"], "Apache-2.0")
        # The only AlephBERT leg is a license-less community fine-tune.
        self.assertEqual(
            by_name["alephbert-ner-community"]["license"], "undeclared"
        )

    def test_revision_tag_format(self):
        spec = encoders.CANDIDATES[0]
        tag = encoders.spec_revision_tag(spec)
        self.assertEqual(tag, "dictabert-ner@05ed61bc+contract1")


if __name__ == "__main__":
    unittest.main()
