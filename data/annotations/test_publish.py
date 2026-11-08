"""Unit tests for the publish stage (issue #2516).

No torch/transformers and no model downloads: `entities_fn` is injected
exactly like the encoder-adapter tests, so the hybrid wiring — lexical
detection, encoder re-type, revision stamping, inference skipping — is
exercised with fakes. One deterministic end-to-end test runs `main()`
with `--no-retype` over the real corpus (the lexical tier is ~2 s).
"""

import contextlib
import hashlib
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


def fake_corpus_two_perakim():
    """One sefer, two perakim: אברם in perek 1, שרה in perek 2."""
    sefarim = [
        {
            "perakim": [
                {
                    "perekId": 1,
                    "pesukim": [pasuk(["וַיֵּלֶךְ", "אַבְרָ֔ם"])],
                },
                {
                    "perekId": 2,
                    "pesukim": [pasuk(["וַתֹּאמֶר", "שָׂרָ֔ה"])],
                },
            ]
        }
    ]
    lexicon = {
        "books": {
            "Gen": {
                "1": {"1": [[1, "אברם", "אַבְרָ֔ם", "Np"]]},
                "2": {"1": [[1, "שרה", "שָׂרָ֔ה", "Np"]]},
            }
        }
    }
    return sefarim, lexicon


def contract_row(**overrides):
    """Minimal contract-shaped decoration row for checkpoint tests."""
    row = {
        "source_kind": "pasuk",
        "surface": "אברם",
        "intended_name": "אברם",
        "entity_type": "PERSON",
        "disambiguation": None,
        "confidence": None,
        "acceptance": "auto",
        "model_revision": "test@1",
        "source_hash": "src",
    }
    return row | overrides


class TestCheckpointStore(unittest.TestCase):
    """The per-unit record contract: version + config + source keys."""

    def store(self, tmp, config="cfg"):
        return publish.CheckpointStore(tmp, "pasuk", config)

    def test_roundtrip_hit(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = self.store(tmp)
            store.save("perek-1", "src", [contract_row()])
            self.assertEqual(
                store.load("perek-1", "src"), [contract_row()]
            )
            self.assertEqual((store.hits, store.misses), (1, 0))

    def test_source_mismatch_is_a_miss(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = self.store(tmp)
            store.save("perek-1", "src", [contract_row()])
            self.assertIsNone(store.load("perek-1", "edited"))
            self.assertEqual((store.hits, store.misses), (0, 1))

    def test_config_mismatch_is_a_miss(self):
        # A model/config change must invalidate every cached unit.
        with tempfile.TemporaryDirectory() as tmp:
            self.store(tmp, "cfg-old").save(
                "perek-1", "src", [contract_row()]
            )
            store = self.store(tmp, "cfg-new")
            self.assertIsNone(store.load("perek-1", "src"))
            self.assertEqual(store.misses, 1)

    def test_corrupt_file_is_a_miss(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = self.store(tmp)
            store.dir.mkdir(parents=True)
            (store.dir / "perek-1.json").write_text(
                "{not json", encoding="utf-8"
            )
            self.assertIsNone(store.load("perek-1", "src"))

    def test_malformed_record_is_a_miss(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = self.store(tmp)
            store.dir.mkdir(parents=True)
            (store.dir / "perek-1.json").write_text(
                json.dumps(
                    {
                        "version": publish.CHECKPOINT_VERSION,
                        "config": "cfg",
                        "source": "src",
                        "rows": "not-a-list",
                    }
                ),
                encoding="utf-8",
            )
            self.assertIsNone(store.load("perek-1", "src"))

    def test_malformed_row_element_is_a_miss(self):
        # A list of non-contract elements must not replay as a hit —
        # hand-edited or foreign unit files recompute instead.
        with tempfile.TemporaryDirectory() as tmp:
            store = self.store(tmp)
            store.dir.mkdir(parents=True)
            (store.dir / "perek-1.json").write_text(
                json.dumps(
                    {
                        "version": publish.CHECKPOINT_VERSION,
                        "config": "cfg",
                        "source": "src",
                        "rows": [{"intended_name": "partial"}],
                    }
                ),
                encoding="utf-8",
            )
            self.assertIsNone(store.load("perek-1", "src"))

    def test_domains_share_a_root_without_colliding(self):
        with tempfile.TemporaryDirectory() as tmp:
            pasuk_store = publish.CheckpointStore(tmp, "pasuk", "cfg")
            article_store = publish.CheckpointStore(tmp, "article", "cfg")
            pasuk_store.save(
                "perek-1", "src", [contract_row(surface="אברם")]
            )
            article_store.save(
                "article-1",
                "src",
                [contract_row(source_kind="article", surface="דוד")],
            )
            self.assertEqual(
                pasuk_store.load("perek-1", "src"),
                [contract_row(surface="אברם")],
            )
            self.assertEqual(
                article_store.load("article-1", "src"),
                [contract_row(source_kind="article", surface="דוד")],
            )

    def test_config_hash_distinguishes_input_shapes(self):
        self.assertNotEqual(
            publish.config_hash(revision="r", lexicon="x"),
            publish.config_hash(revision="r", lexicon="x", canonical="y"),
        )
        self.assertNotEqual(
            publish.config_hash(revision="a", lexicon="x"),
            publish.config_hash(revision="b", lexicon="x"),
        )


class TestCheckpointedPasukRows(unittest.TestCase):
    """Resumable runs: cached units skip detection AND inference."""

    def store(self, tmp):
        return publish.CheckpointStore(
            tmp, "pasuk", publish.config_hash(revision="hybrid@1", lexicon="x")
        )

    def test_resume_skips_detection_and_inference(self):
        sefarim, lexicon = fake_corpus_two_perakim()
        entities_fn = mock.Mock(return_value=[])
        with tempfile.TemporaryDirectory() as tmp:
            cold = publish.pasuk_rows(
                sefarim,
                lexicon,
                entities_fn,
                "hybrid@1",
                checkpoint=self.store(tmp),
            )
            calls_cold = entities_fn.call_count
            entities_fn.reset_mock()
            warm = publish.pasuk_rows(
                sefarim,
                lexicon,
                entities_fn,
                "hybrid@1",
                checkpoint=self.store(tmp),
            )
        self.assertGreater(calls_cold, 0)
        entities_fn.assert_not_called()
        # Cached rows are the exact emitted rows — warm == cold.
        self.assertEqual(warm, cold)

    def test_edited_perek_invalidates_only_its_unit(self):
        sefarim, lexicon = fake_corpus_two_perakim()
        entities_fn = mock.Mock(return_value=[])
        with tempfile.TemporaryDirectory() as tmp:
            publish.pasuk_rows(
                sefarim,
                lexicon,
                entities_fn,
                "hybrid@1",
                checkpoint=self.store(tmp),
            )
            entities_fn.reset_mock()
            # Edit perek 2's text — שרה's pasuk gains a word.
            sefarim[0]["perakim"][1]["pesukim"][0]["segments"].append(
                {"value": "הַמֶּ֔לֶךְ", "type": "qri"}
            )
            store = self.store(tmp)
            publish.pasuk_rows(
                sefarim,
                lexicon,
                entities_fn,
                "hybrid@1",
                checkpoint=store,
            )
            self.assertEqual(store.hits, 1)
            self.assertEqual(store.misses, 1)
            # Only perek 2's view reached the model.
            calls = [c.args[0] for c in entities_fn.call_args_list]
            self.assertEqual(calls, ["ותאמר שרה המלך"])

    def test_reordered_perakim_recompute(self):
        # Chapter assignment is positional: moving an unchanged perek
        # changes which lexicon chapter it matches — the checkpoint key
        # covers stem+chapter, so both units recompute (never replay).
        sefarim, lexicon = fake_corpus_two_perakim()
        with tempfile.TemporaryDirectory() as tmp:
            store = self.store(tmp)
            publish.pasuk_rows(sefarim, lexicon, checkpoint=store)
            self.assertEqual((store.hits, store.misses), (0, 2))
            sefarim[0]["perakim"].reverse()
            warm = publish.pasuk_rows(
                sefarim, lexicon, checkpoint=store
            )
            self.assertEqual((store.hits, store.misses), (0, 4))
            fresh = publish.pasuk_rows(sefarim, lexicon)
        self.assertEqual(warm, fresh)

    def test_no_retype_run_is_byte_identical_through_cache(self):
        sefarim, lexicon = fake_corpus_two_perakim()
        with tempfile.TemporaryDirectory() as tmp:
            cold = publish.pasuk_rows(
                sefarim, lexicon, checkpoint=self.store(tmp)
            )
            warm = publish.pasuk_rows(
                sefarim, lexicon, checkpoint=self.store(tmp)
            )
        self.assertEqual(warm, cold)
        self.assertEqual(len(cold), 2)


class TestCheckpointedArticleRows(unittest.TestCase):
    """Article units key on content_hash — the contract's staleness key."""

    GAZETTEER = {"דוד": "PERSON"}

    def store(self, tmp):
        return publish.CheckpointStore(
            tmp,
            "article",
            publish.config_hash(
                revision="hybrid@1", lexicon="x", canonical="y"
            ),
        )

    def test_resume_skips_inference_and_replays_rows(self):
        entities_fn = mock.Mock(return_value=[])
        articles = [(1, "<p>הלך דוד</p>"), (2, "<p>שלום</p>")]
        with tempfile.TemporaryDirectory() as tmp:
            cold = publish.article_rows(
                articles,
                self.GAZETTEER,
                entities_fn=entities_fn,
                model_revision="hybrid@1",
                checkpoint=self.store(tmp),
            )
            entities_fn.reset_mock()
            warm = publish.article_rows(
                articles,
                self.GAZETTEER,
                entities_fn=entities_fn,
                model_revision="hybrid@1",
                checkpoint=self.store(tmp),
            )
        entities_fn.assert_not_called()
        self.assertEqual(warm, cold)

    def test_edited_content_invalidates_only_its_article(self):
        entities_fn = mock.Mock(return_value=[])
        articles = [(1, "<p>הלך דוד</p>"), (2, "<p>בא דוד</p>")]
        with tempfile.TemporaryDirectory() as tmp:
            publish.article_rows(
                articles,
                self.GAZETTEER,
                entities_fn=entities_fn,
                model_revision="hybrid@1",
                checkpoint=self.store(tmp),
            )
            entities_fn.reset_mock()
            articles[1] = (2, "<p>בא דוד הביתה</p>")
            store = self.store(tmp)
            publish.article_rows(
                articles,
                self.GAZETTEER,
                entities_fn=entities_fn,
                model_revision="hybrid@1",
                checkpoint=store,
            )
            self.assertEqual((store.hits, store.misses), (1, 1))
            # Only the edited article's run reached the model.
            calls = [c.args[0] for c in entities_fn.call_args_list]
            self.assertEqual(calls, ["בא דוד הביתה"])

    def test_canonical_change_invalidates_article_units(self):
        # The gazetteer is corpus-derived: a canonical edit must re-run
        # every article unit even when no article byte changed.
        articles = [(1, "<p>הלך דוד</p>")]
        with tempfile.TemporaryDirectory() as tmp:
            old = publish.CheckpointStore(
                tmp,
                "article",
                publish.config_hash(
                    revision="hybrid@1", lexicon="x", canonical="old"
                ),
            )
            publish.article_rows(
                articles, self.GAZETTEER, checkpoint=old
            )
            new = publish.CheckpointStore(
                tmp,
                "article",
                publish.config_hash(
                    revision="hybrid@1", lexicon="x", canonical="new"
                ),
            )
            content_hash = hashlib.sha256(
                articles[0][1].encode("utf-8")
            ).hexdigest()
            self.assertIsNone(new.load("article-1", content_hash))


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

    def test_checkpoint_dir_resumes_and_replays_identical_rows(self):
        # Real corpus, --no-retype (~4 s for two runs): the resume path
        # must emit byte-identical output and mark every unit cached.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "rows.json"
            cache = Path(tmp) / "cache"
            argv = [
                "publish.py",
                "--pasuk-out",
                str(out),
                "--no-retype",
                "--checkpoint-dir",
                str(cache),
            ]
            with mock.patch.object(publish.sys, "argv", argv):
                with contextlib.redirect_stdout(io.StringIO()):
                    publish.main()
            cold_bytes = out.read_bytes()
            units = list((cache / "pasuk").glob("perek-*.json"))
            self.assertEqual(len(units), 929)
            out.unlink()
            stdout = io.StringIO()
            with mock.patch.object(publish.sys, "argv", argv):
                with contextlib.redirect_stdout(stdout):
                    publish.main()
            self.assertEqual(out.read_bytes(), cold_bytes)
            self.assertIn("929 cached, 0 computed", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
