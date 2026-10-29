"""Unit tests for the publish stage (issue #2516).

No torch/transformers and no model downloads: `entities_fn` is injected
exactly like the encoder-adapter tests, so the hybrid wiring — lexical
detection, encoder re-type, revision stamping, inference skipping — is
exercised with fakes. One deterministic end-to-end test runs `main()`
with `--no-retype` over the real corpus (the lexical tier is ~2 s).
"""

import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import unittest.mock

import baseline
import baseline_articles
import publish

mock = unittest.mock


def fake_entities(*entities):
    """entities_fn stub: canned (label, start, end, score) outputs."""

    def entities_fn(text):
        return [
            {"entity_group": label, "score": score, "start": start, "end": end}
            for label, start, end, score in entities
        ]

    return entities_fn


def pasuk(values):
    """Minimal canonical pasuk: qri segments only."""
    return {"segments": [{"value": v, "type": "qri"} for v in values]}


def fake_corpus():
    """One sefer, one perek: pasuk 1 has אברם tagged, pasuk 2 has nothing."""
    sefarim = [
        {
            "perakim": [
                {
                    "perekId": 1,
                    "pesukim": [
                        pasuk(["וַיֵּלֶךְ", "אַבְרָ֔ם"]),
                        pasuk(["וַיֹּאמֶר"]),
                    ],
                }
            ]
        }
    ]
    lexicon = {
        "books": {
            "Gen": {"1": {"1": [[1, "אברם", "אַבְרָ֔ם", "Np"]], "2": []}}
        }
    }
    return sefarim, lexicon


class TestRetypeSpecResolution(unittest.TestCase):
    def test_default_candidate_resolves(self):
        spec = publish.resolve_retype_spec(publish.RETYPE_DEFAULT)
        self.assertEqual(spec["name"], "dictabert-ner-retype")
        self.assertEqual(spec["mode"], "retype")

    def test_detect_only_candidate_is_rejected(self):
        # `dictabert-ner` (detect mode) is not a shipped publish path —
        # detection stays the lexical tier's.
        with self.assertRaises(SystemExit) as ctx:
            publish.resolve_retype_spec("dictabert-ner")
        self.assertIn("retype", str(ctx.exception))

    def test_unrunnable_candidate_is_rejected(self):
        with self.assertRaises(SystemExit):
            publish.resolve_retype_spec("berel")

    def test_unlicensed_candidate_is_rejected(self):
        # The AlephBERT community fine-tune declares no license — it
        # measured well but cannot ship, and publish is a ship path.
        with self.assertRaises(SystemExit):
            publish.resolve_retype_spec("alephbert-ner-community-retype")

    def test_unknown_name_lists_choices(self):
        with self.assertRaises(SystemExit) as ctx:
            publish.resolve_retype_spec("no-such-model")
        self.assertIn("dictabert-ner-retype", str(ctx.exception))


class TestPasukRows(unittest.TestCase):
    def test_detection_only_matches_baseline(self):
        sefarim, lexicon = fake_corpus()
        rows = publish.pasuk_rows(sefarim, lexicon)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["intended_name"], "אברם")
        self.assertEqual(row["entity_type"], "PERSON")
        self.assertEqual(row["acceptance"], "auto")
        self.assertEqual(row["model_revision"], baseline.MODEL_REVISION)

    def test_retype_changes_type_and_stamps_revision(self):
        sefarim, lexicon = fake_corpus()
        # GPE on אברם's normalized range ([5,9) in "וילך אברם").
        rows = publish.pasuk_rows(
            sefarim,
            lexicon,
            fake_entities(("GPE", 5, 9, 0.9)),
            model_revision="hybrid@1",
        )
        self.assertEqual(rows[0]["entity_type"], "PLACE")
        self.assertEqual(rows[0]["model_revision"], "hybrid@1")

    def test_abstain_keeps_type_but_still_stamps_revision(self):
        sefarim, lexicon = fake_corpus()
        # The encoder votes on a different word — no type for אברם.
        rows = publish.pasuk_rows(
            sefarim,
            lexicon,
            fake_entities(("LOC", 0, 4, 0.9)),
            model_revision="hybrid@1",
        )
        self.assertEqual(rows[0]["entity_type"], "PERSON")
        self.assertEqual(rows[0]["model_revision"], "hybrid@1")

    def test_pesukim_without_detections_skip_inference(self):
        sefarim, lexicon = fake_corpus()
        entities_fn = mock.Mock(return_value=[])
        publish.pasuk_rows(sefarim, lexicon, entities_fn, "hybrid@1")
        # Pasuk 2 has no baseline rows — its view never reaches the model.
        calls = [call.args[0] for call in entities_fn.call_args_list]
        self.assertEqual(calls, ["וילך אברם"])


class TestArticleRows(unittest.TestCase):
    GAZETTEER = {"דוד": "PERSON", "שכם": "PERSON"}

    def articles(self, *contents):
        """(id, content) pairs as load_articles returns them."""
        return [(i + 1, content) for i, content in enumerate(contents)]

    def test_detection_only_matches_baseline(self):
        rows = publish.article_rows(
            self.articles("<p>הלך דוד לשכם</p>"), self.GAZETTEER
        )
        self.assertEqual(
            [(r["intended_name"], r["entity_type"]) for r in rows],
            [("דוד", "PERSON"), ("שכם", "PERSON")],
        )
        self.assertEqual(
            rows[0]["model_revision"], baseline_articles.MODEL_REVISION
        )

    def test_retype_fixes_gazetteer_type(self):
        # 'לשכם' at normalized-run offset [8,12) votes LOC -> PLACE.
        rows = publish.article_rows(
            self.articles("<p>הלך דוד לשכם</p>"),
            self.GAZETTEER,
            entities_fn=fake_entities(("LOC", 8, 12, 0.9)),
            model_revision="hybrid@1",
        )
        by_name = {row["intended_name"]: row for row in rows}
        self.assertEqual(by_name["שכם"]["entity_type"], "PLACE")
        self.assertEqual(by_name["דוד"]["entity_type"], "PERSON")
        self.assertTrue(
            all(row["model_revision"] == "hybrid@1" for row in rows)
        )

    def test_empty_detection_skips_inference(self):
        entities_fn = mock.Mock(return_value=[])
        rows = publish.article_rows(
            self.articles("<p>שלום עולם</p>"), self.GAZETTEER,
            entities_fn=entities_fn, model_revision="hybrid@1",
        )
        self.assertEqual(rows, [])
        entities_fn.assert_not_called()


class TestMain(unittest.TestCase):
    def test_article_out_requires_articles_input(self):
        argv = ["publish.py", "--article-out", "x.json"]
        with mock.patch.object(publish.sys, "argv", argv):
            with self.assertRaises(SystemExit):
                publish.main()

    def test_nothing_to_publish_is_an_error(self):
        argv = ["publish.py", "--no-retype"]
        with mock.patch.object(publish.sys, "argv", argv):
            with self.assertRaises(SystemExit):
                publish.main()

    def test_no_retype_pasuk_run_is_deterministic(self):
        # Real corpus (~2 s): the lexical tier stays reproducible offline.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "rows.json"
            argv = [
                "publish.py",
                "--pasuk-out",
                str(out),
                "--no-retype",
            ]
            with mock.patch.object(publish.sys, "argv", argv):
                with contextlib.redirect_stdout(io.StringIO()):
                    publish.main()
            rows = json.loads(out.read_text(encoding="utf-8"))
        self.assertGreater(len(rows), 30000)
        self.assertTrue(
            all(
                row["model_revision"] == baseline.MODEL_REVISION
                for row in rows
            )
        )
        self.assertTrue(
            all(row["source_kind"] == "pasuk" for row in rows)
        )


if __name__ == "__main__":
    unittest.main()
