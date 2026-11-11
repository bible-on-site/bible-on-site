"""Detection safety/recall-contract tests; no model weights or torch needed."""

import collections
import json
import unittest
from unittest import mock

import llm_detect as detect


def raw(*mentions):
    return json.dumps({"mentions": list(mentions)}, ensure_ascii=False)


def mention(start=0, end=0, surface="דוד", name="דוד", entity_type="PERSON"):
    return {"start": start, "end": end, "surface": surface,
            "intended_name": name, "entity_type": entity_type}


def pasuk(*words):
    return {"segments": [{"type": "qri", "value": word} for word in words]}


class TestStrictOutput(unittest.TestCase):
    def setUp(self):
        self.units = [{"index": i, "text": word} for i, word in enumerate(["דוד", "בית", "אל"])]
        self.surface = lambda start, end: " ".join(unit["text"] for unit in self.units[start:end + 1])

    def test_exact_multiword_span_and_other(self):
        valid = [mention(1, 2, "בית אל", "בית אל", "PLACE"),
                 mention(0, 0, "דוד", "", "OTHER")]
        self.assertEqual(detect.validate_output(raw(*valid), self.units, self.surface), valid)

    def test_invalid_bounds_surfaces_types_and_names_are_rejected(self):
        cases = [
            mention(start=True), mention(start=-1), mention(end=3),
            mention(start=2, end=1), mention(surface="דויד"),
            mention(entity_type="SQL"), mention(name="<דוד>"),
            mention(name="דָוִד"), mention(name=""),
            mention(entity_type="OTHER"),
        ]
        for value in cases:
            with self.subTest(value=value), self.assertRaises(ValueError):
                detect.validate_output(raw(value), self.units, self.surface)

    def test_schema_and_overlap_fail_closed(self):
        for value in ("```json\n{}", "[]", '{"mentions":[],"sql":"x"}',
                      raw(mention(), mention())):
            with self.subTest(value=value), self.assertRaises(ValueError):
                detect.validate_output(value, self.units, self.surface)

    def test_noncontiguous_original_indices_cannot_be_bridged(self):
        units = [{"index": 0, "text": "בית"}, {"index": 2, "text": "אל"}]
        with self.assertRaisesRegex(ValueError, "noncontiguous"):
            detect.validate_output(raw(mention(0, 2, "בית אל", "בית אל", "PLACE")),
                                   units, lambda _a, _b: "בית אל")


class TestIndependentDetection(unittest.TestCase):
    def test_common_noun_types_are_not_gated_by_morphology_or_existing_entries(self):
        for word, entity_type in [("אריה", "ANIMAL"), ("אלון", "PLANT"),
                                  ("מנורה", "TEMPLE_TOOL"), ("ירח", "ASTRONOMICAL_OBJECT")]:
            seen = []

            def generate(messages):
                seen.append(json.loads(messages[-1]["content"]))
                return raw(mention(surface=word, name=word, entity_type=entity_type))

            with mock.patch.object(detect.baseline, "load_lexicon", side_effect=AssertionError("lexicon gate")):
                rows = detect.decorations_for_pasuk(pasuk(word), 4, 2, generate)
            self.assertEqual(rows[0]["entity_type"], entity_type)
            self.assertEqual(seen[0]["units"], [{"index": 0, "text": word}])

    def test_scripture_keeps_exact_vocalized_source_and_original_coordinates(self):
        p = pasuk("וַיֵּלֶךְ", "דָּוִד")
        rows = detect.decorations_for_pasuk(p, 7, 9,
            lambda _messages: raw(mention(1, 1, "דָּוִד", "דוד")), "revision")
        self.assertEqual(rows[0]["segment_start"], 1)
        self.assertEqual(rows[0]["surface"], p["segments"][1]["value"])
        self.assertEqual(rows[0]["pasuk_number"], 7)
        self.assertEqual(rows[0]["perek_id"], 9)
        self.assertEqual(rows[0]["model_revision"], "revision")

    def test_invalid_generation_emits_no_rows_and_records_failure(self):
        diagnostics = collections.Counter()
        rows = detect.decorations_for_pasuk(pasuk("דוד"), 1, 1,
                                            lambda _messages: "invented", diagnostics=diagnostics)
        self.assertEqual(rows, [])
        self.assertEqual(diagnostics["invalid_response_chunks"], 1)

    def test_other_abstains_without_inventing_an_enum_or_rendered_row(self):
        diagnostics = collections.Counter()
        rows = detect.decorations_for_pasuk(pasuk("דוד"), 1, 1,
            lambda _messages: raw(mention(name="", entity_type="OTHER")), diagnostics=diagnostics)
        self.assertEqual(rows, [])
        self.assertEqual(diagnostics["abstained_mentions"], 1)

    def test_articles_skip_anchor_script_style_and_keep_utf16_offsets(self):
        content = "<p>😀 דוד</p><a href='/x'>סוד</a><script>אסור</script><style>מוסתר</style>"
        seen = []

        def generate(messages):
            seen.append(messages[-1]["content"])
            return raw(mention())

        rows = detect.decorations_for_article(5, content, generate)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row["span_start"], row["span_end"]), (6, 9))
        encoded = content.encode("utf-16-le")
        self.assertEqual(encoded[row["span_start"] * 2:row["span_end"] * 2].decode("utf-16-le"), "דוד")
        self.assertNotIn("סוד", " ".join(seen))
        self.assertNotIn("אסור", " ".join(seen))
        self.assertNotIn("מוסתר", " ".join(seen))

    def test_acronym_word_and_original_hyphenated_compound_map_losslessly(self):
        content = "<p>רש\"י בבית־אל</p>"
        seen = []

        def generate(messages):
            data = json.loads(messages[-1]["content"])
            seen.extend(data["units"])
            return raw(mention(0, 0, 'רש"י', "רשי"),
                       mention(1, 2, "בבית־אל", "בית אל", "PLACE"))

        rows = detect.decorations_for_article(2, content, generate)
        self.assertEqual(seen[0]["text"], 'רש"י')
        self.assertEqual([r["surface"] for r in rows], ['רש"י', "בבית־אל"])


class TestBoundedChunks(unittest.TestCase):
    def test_exact_token_counter_limits_windows_and_every_word_is_seen(self):
        units = [{"index": i, "text": "דוד"} for i in range(45)]
        generate = mock.Mock(spec=[])
        generate.count_input_tokens = lambda messages: len(json.loads(messages[-1]["content"])["units"]) * 600
        chunks = list(detect.bounded_chunks(units,
            lambda a, b: " ".join("דוד" for _ in range(a, b + 1)), generate))
        self.assertTrue(all(len(chunk) <= 5 for chunk, _ in chunks))
        self.assertEqual({unit["index"] for chunk, _ in chunks for unit in chunk}, set(range(45)))
        self.assertTrue(any(set(u["index"] for u in chunks[i][0]) &
                            set(u["index"] for u in chunks[i + 1][0])
                            for i in range(len(chunks) - 1)))

    def test_oversized_single_unit_is_diagnosed_without_truncation(self):
        diagnostics = collections.Counter()
        generate = mock.Mock(spec=[])
        rows = detect.decorations_for_pasuk(pasuk("ד" * 5000), 1, 1, generate,
                                            diagnostics=diagnostics)
        generate.assert_not_called()
        self.assertEqual(rows, [])
        self.assertEqual(diagnostics["oversized_source_units"], 1)

    def test_oversized_unit_does_not_discard_later_valid_source_words(self):
        diagnostics = collections.Counter()

        def generate(_messages):
            return raw(mention(1, 1, "דוד", "דוד"))

        def count(messages):
            units = json.loads(messages[-1]["content"])["units"]
            return detect.local_llm.MAX_INPUT_TOKENS + 1 if any(len(unit["text"]) > 100 for unit in units) else 10

        generate.count_input_tokens = count
        rows = detect.decorations_for_pasuk(pasuk("א" * 5000, "דוד"), 1, 1, generate,
                                            diagnostics=diagnostics)
        self.assertEqual([row["surface"] for row in rows], ["דוד"])
        self.assertEqual(rows[0]["segment_start"], 1)
        self.assertEqual(diagnostics["oversized_source_units"], 1)
        self.assertEqual(diagnostics["valid_response_chunks"], 1)

    def test_conflicting_windows_are_held(self):
        units = [{"index": 0, "text": "דוד"}]
        generate = mock.Mock(side_effect=[raw(mention()), raw(mention(entity_type="PLACE"))])
        messages = detect.build_messages("דוד", units)
        with mock.patch.object(detect, "bounded_chunks", return_value=[(units, messages), (units, messages)]):
            rows = detect._detect(units, lambda _a, _b: "דוד", generate,
                                  lambda value: dict(value, acceptance="auto"))
        self.assertEqual(rows[0]["acceptance"], "held")


class TestEvaluationScope(unittest.TestCase):
    def test_only_requested_verse_text_reaches_model_and_gold_labels_never_do(self):
        perek = {"perekId": 3, "pesukim": [pasuk("סוד"), pasuk("דוד"), pasuk("אסור")]}
        cases = [{"id": "case", "pasuk": 2, "mentions": [{"name": "SECRET_GOLD_LABEL"}]}]
        seen = []

        def generate(messages):
            seen.append(_all_text(messages))
            return raw(mention())

        def score(_cases, _sefarim, predict, _revision):
            rows = predict(perek, "Gen", 1)
            self.assertEqual([row["pasuk_number"] for row in rows], [2])
            return {"metrics": {}}

        with (
            mock.patch.object(detect.baseline, "load_canonical", return_value=[]),
            mock.patch.object(detect.ge, "load_golden", side_effect=[{"cases": cases}, {"cases": []}]),
            mock.patch.object(detect.ge, "resolve_pasuk", return_value=(perek, "Gen", 1)),
            mock.patch.object(detect.ge, "evaluate_pasuk", side_effect=score),
            mock.patch.object(detect.ge, "evaluate_articles", return_value={"metrics": {}}),
        ):
            report = detect.evaluate_candidate(device="cpu", dtype="float32", generate_fn=generate)
        text = " ".join(seen)
        self.assertIn("דוד", text)
        self.assertNotIn("סוד", text)
        self.assertNotIn("אסור", text)
        self.assertNotIn("SECRET_GOLD_LABEL", text)
        self.assertEqual(report["diagnostics"]["chunks"], 1)

    def test_candidate_precision_and_prompt_use_independent_cache_identity(self):
        with mock.patch.object(detect.encoders, "runtime_signature", return_value={"torch": "test"}):
            cpu = detect.revision_tag({"device": "cpu", "dtype": "float32"})
            gpu = detect.revision_tag({"device": "cuda:0", "dtype": "bfloat16"})
        self.assertNotEqual(cpu, gpu)
        qwen = detect.detection_spec(detect.local_llm.MODEL_CANDIDATES["qwen3-8b-retype"])
        self.assertIn("qwen3-8b-detect", detect.revision_tag(spec=qwen))
        self.assertNotEqual(cpu, detect.revision_tag(spec=qwen))
        self.assertNotEqual(cpu, detect.local_llm.revision_tag())


def _all_text(messages):
    return " ".join(message["content"] for message in messages)


if __name__ == "__main__":
    unittest.main()
