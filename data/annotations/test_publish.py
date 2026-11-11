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
        "perek_id": 1,
        "pasuk_number": 1,
        "segment_start": 0,
        "segment_end": 0,
        "surface": "אברם",
        "intended_name": "אברם",
        "entity_type": "PERSON",
        "disambiguation": None,
        "confidence": None,
        "acceptance": "auto",
        "model_revision": "test@1",
        "source_hash": "a" * 64,
    }
    if overrides.get("source_kind") == "article":
        row.update(article_id=1, span_start=0, span_end=3, content_hash="b" * 64)
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

    def test_corrupt_coordinates_and_enums_are_cache_misses(self):
        bad = [contract_row(segment_start=True), contract_row(segment_end=-1),
               contract_row(entity_type=[]), contract_row(acceptance="publish"),
               contract_row(source_hash="not-a-hash"), contract_row(confidence=float("nan")),
               contract_row(source_kind="article", span_start=5, span_end=2)]
        missing = contract_row()
        del missing["pasuk_number"]
        bad.append(missing)
        with tempfile.TemporaryDirectory() as tmp:
            for row in bad:
                with self.subTest(row=row):
                    store = self.store(tmp)
                    store.save("perek-1", "src", [row])
                    self.assertIsNone(store.load("perek-1", "src"))

    def test_diagnostics_roundtrip_and_corrupt_diagnostics_miss(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = self.store(tmp)
            store.save("perek-1", "src", [contract_row()], {"valid_response_chunks": 2})
            self.assertIsNotNone(store.load("perek-1", "src"))
            self.assertEqual(store.last_diagnostics, {"valid_response_chunks": 2})
            store.save("perek-1", "src", [contract_row()], {"invalid_response_chunks": True})
            self.assertIsNone(store.load("perek-1", "src"))

    def test_legacy_incomplete_record_is_a_retryable_miss_with_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = self.store(tmp)
            store.save("perek-1", "src", [], {"invalid_response_chunks": 2})
            path = store.dir / "perek-1.json"
            legacy = json.loads(path.read_text(encoding="utf-8"))
            del legacy["failure_history"]
            path.write_text(json.dumps(legacy), encoding="utf-8")
            resumed = self.store(tmp)
            self.assertIsNone(resumed.load("perek-1", "src"))
            self.assertEqual((resumed.hits, resumed.misses), (0, 1))
            self.assertEqual(resumed.failure_history["invalid_response_chunks"], 2)

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


class TestLlmEngines(unittest.TestCase):
    def corpus(self):
        return [{"perakim": [
            {"perekId": 1, "pesukim": [pasuk(["אריה", "שאג"])]},
            {"perekId": 2, "pesukim": [pasuk(["דוב", "הלך"])]},
        ]}]

    def detector(self, messages):
        units = json.loads(messages[-1]["content"])["units"]
        word = units[0]
        return json.dumps({"mentions": [{"start": word["index"], "end": word["index"],
            "intended_name": word["text"], "entity_type": "ANIMAL"}]})

    def retyper(self, messages):
        candidates = json.loads(messages[-1]["content"])["candidates"]
        return json.dumps({"decisions": [{"id": candidate["id"],
            "intended_name": candidate["intended_name"], "entity_type": "PLACE", "decision": "accept"}
            for candidate in candidates]})

    def test_independent_detection_bypasses_lexical_gate_and_respects_unit_limits(self):
        seen = []
        def generate(messages):
            seen.append(messages)
            return self.detector(messages)
        with mock.patch.object(publish.baseline, "decorations_for_perek", side_effect=AssertionError("lexical gate")):
            rows = publish.pasuk_rows(self.corpus(), None, engine="llm-detect",
                generate_fn=generate, model_revision="detect@1", max_perakim=1)
        self.assertEqual(len(seen), 1)
        self.assertEqual([(row["perek_id"], row["entity_type"]) for row in rows], [(1, "ANIMAL")])
        self.assertEqual(rows[0]["model_revision"], "detect@1")

    def test_detect_checkpoint_skips_generation_and_replays_diagnostics(self):
        with tempfile.TemporaryDirectory() as tmp:
            cold_stats = publish.collections.Counter()
            cold = publish.pasuk_rows(self.corpus(), None, engine="llm-detect",
                generate_fn=self.detector, model_revision="detect@1", max_perakim=1,
                checkpoint=publish.CheckpointStore(tmp, "pasuk", "cfg"), diagnostics=cold_stats)
            warm_stats = publish.collections.Counter()
            forbidden = mock.Mock(spec=[], side_effect=AssertionError("cached model call"))
            warm = publish.pasuk_rows(self.corpus(), None, engine="llm-detect",
                generate_fn=forbidden, model_revision="detect@1", max_perakim=1,
                checkpoint=publish.CheckpointStore(tmp, "pasuk", "cfg"), diagnostics=warm_stats)
        self.assertEqual(cold, warm)
        self.assertEqual(cold_stats, warm_stats)
        self.assertEqual(warm_stats["valid_response_chunks"], 1)
        forbidden.assert_not_called()

    def test_increasing_unit_limit_resumes_only_the_new_perek(self):
        calls = []
        def generate(messages):
            calls.append(messages)
            return self.detector(messages)
        with tempfile.TemporaryDirectory() as tmp:
            publish.pasuk_rows(self.corpus(), None, engine="llm-detect", generate_fn=generate,
                model_revision="detect@1", max_perakim=1,
                checkpoint=publish.CheckpointStore(tmp, "pasuk", "cfg"))
            calls.clear()
            store = publish.CheckpointStore(tmp, "pasuk", "cfg")
            rows = publish.pasuk_rows(self.corpus(), None, engine="llm-detect", generate_fn=generate,
                model_revision="detect@1", max_perakim=2, checkpoint=store)
        self.assertEqual(len(calls), 1)
        self.assertEqual((store.hits, store.misses), (1, 1))
        self.assertEqual([row["perek_id"] for row in rows], [1, 2])

    def test_failed_detection_retries_on_resume_and_retains_quarantined_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []
            def transient(messages):
                calls.append(1)
                return "invalid" if len(calls) == 1 else self.detector(messages)

            request_dir = Path(tmp) / "requests"
            first_cache = publish.local_llm.CachedGenerator(transient, request_dir, "detect@1")
            first_store = publish.CheckpointStore(tmp, "pasuk", "cfg")
            failed_stats = publish.collections.Counter()
            failed = publish.pasuk_rows(self.corpus(), None, engine="llm-detect",
                generate_fn=first_cache, model_revision="detect@1", max_perakim=1,
                checkpoint=first_store, diagnostics=failed_stats)
            self.assertEqual(failed, [])
            self.assertEqual(failed_stats["invalid_response_chunks"], 1)
            second_cache = publish.local_llm.CachedGenerator(transient, request_dir, "detect@1")
            second_store = publish.CheckpointStore(tmp, "pasuk", "cfg")
            recovered_stats = publish.collections.Counter()
            recovered = publish.pasuk_rows(self.corpus(), None, engine="llm-detect",
                generate_fn=second_cache, model_revision="detect@1", max_perakim=1,
                checkpoint=second_store, diagnostics=recovered_stats)
            self.assertEqual(recovered[0]["entity_type"], "ANIMAL")
            self.assertEqual((second_store.hits, second_store.misses), (0, 1))
            self.assertEqual(recovered_stats["invalid_response_chunks"], 0)
            self.assertEqual(second_store.failure_history["invalid_response_chunks"], 1)
            self.assertEqual(len(calls), 2)
            self.assertTrue(list((request_dir / "invalid").glob("*.reason.json")))
            output = Path(tmp) / "rows.json"
            output.write_text(json.dumps(recovered), encoding="utf-8")
            publish.write_provenance(output, spec=None, execution=None, entities_fn=second_cache,
                checkpoint=second_store, runtime={}, engine="llm-detect", diagnostics=recovered_stats)
            provenance = json.loads(Path(f"{output}.provenance.json").read_text(encoding="utf-8"))
            self.assertTrue(provenance["complete_valid_responses"])
            self.assertEqual(provenance["failure_history"]["invalid_response_chunks"], 1)
            warm_store = publish.CheckpointStore(tmp, "pasuk", "cfg")
            warm = publish.pasuk_rows(self.corpus(), None, engine="llm-detect",
                generate_fn=lambda _: self.fail("valid unit should stay cached"),
                model_revision="detect@1", max_perakim=1, checkpoint=warm_store)
            self.assertEqual(warm, recovered)
            self.assertEqual(warm_store.hits, 1)
            self.assertEqual(warm_store.failure_history["invalid_response_chunks"], 1)
            self.assertEqual(len(calls), 2)

    def test_llm_retype_changes_only_supplied_candidates_and_collects_diagnostics(self):
        corpus, lexicon = fake_corpus()
        def generate(messages):
            return self.retyper(messages)
        generate.diagnostics = publish.collections.Counter()
        diagnostics = publish.collections.Counter()
        rows = publish.pasuk_rows(corpus, lexicon, engine="llm-retype", generate_fn=generate,
                                   model_revision="llm@1", diagnostics=diagnostics)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["entity_type"], "PLACE")
        self.assertEqual(rows[0]["surface"], "אַבְרָ֔ם")
        self.assertEqual(diagnostics["accept"], 1)

    def test_article_detection_needs_no_gazetteer_and_stops_at_limit(self):
        with mock.patch.object(publish.baseline_articles, "decorations_for_article", side_effect=AssertionError("gazetteer gate")):
            rows = publish.article_rows([(1, "<p>אריה</p>"), (2, "<p>דוב</p>")], None,
                engine="llm-detect", generate_fn=self.detector, model_revision="detect@1", max_articles=1)
        self.assertEqual([row["article_id"] for row in rows], [1])
        self.assertEqual(rows[0]["entity_type"], "ANIMAL")

    def test_invalid_engines_generators_and_limits_fail_before_work(self):
        for kwargs in ({"engine": "unknown"}, {"engine": "llm-detect"},
                       {"max_perakim": 0}, {"max_perakim": True}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                publish.pasuk_rows([], None, **kwargs)

    def test_lazy_generator_keeps_weights_unloaded_until_request_or_token_count(self):
        spec = publish.local_llm.CANDIDATE
        execution = {"device": "cpu", "dtype": "float32", "tf32": False}
        loaded = mock.Mock()
        loaded.execution = execution
        loaded.stats = {"generated_requests": 0}
        loaded.count_input_tokens.return_value = 40
        loaded.return_value = "response"
        with mock.patch.object(publish.local_llm, "load_generate_fn", return_value=loaded) as load:
            generate = publish.lazy_generate_fn(spec, execution)
            load.assert_not_called()
            self.assertFalse(generate.model_loaded)
            self.assertEqual(generate.count_input_tokens([]), 40)
            self.assertEqual(generate([]), "response")
            load.assert_called_once_with(spec, device="cpu", dtype="float32")
            self.assertTrue(generate.model_loaded)


class TestMain(unittest.TestCase):
    def test_quantized_model_rejects_cpu_before_model_or_source_loading(self):
        argv = ["publish.py", "--pasuk-out", "unused.json", "--engine", "llm-detect",
                "--llm-model", "qwen3-8b-retype"]
        with (
            mock.patch.object(publish.sys, "argv", argv),
            mock.patch.object(publish.baseline, "load_canonical") as corpus,
            mock.patch.object(publish, "lazy_generate_fn") as load,
            contextlib.redirect_stderr(io.StringIO()),
        ):
            with self.assertRaises(SystemExit):
                publish.main()
        corpus.assert_not_called()
        load.assert_not_called()

    def test_llm_detect_cli_writes_contract_rows_and_engine_provenance_without_lexicon(self):
        execution = {"device": "cpu", "dtype": "float32", "tf32": False}
        generate = TestLlmEngines().detector
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "rows.json"
            argv = ["publish.py", "--pasuk-out", str(out), "--engine", "llm-detect",
                    "--max-perakim", "1", "--checkpoint-dir", str(Path(tmp) / "cache")]
            with (
                mock.patch.object(publish.sys, "argv", argv),
                mock.patch.object(publish.baseline, "load_canonical", return_value=TestLlmEngines().corpus()),
                mock.patch.object(publish.baseline, "load_lexicon", side_effect=AssertionError("lexicon gate")),
                mock.patch.object(publish.encoders, "normalize_execution", return_value=execution),
                mock.patch.object(publish.encoders, "runtime_signature", return_value={"torch": "test"}),
                mock.patch.object(publish, "lazy_generate_fn", return_value=generate),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                publish.main()
            rows = json.loads(out.read_text(encoding="utf-8"))
            provenance = json.loads(Path(f"{out}.provenance.json").read_text(encoding="utf-8"))
        self.assertTrue(publish._valid_rows(rows))
        self.assertEqual(provenance["engine"], "llm-detect")
        self.assertEqual(provenance["limits"], {"max_perakim": 1})
        self.assertTrue(provenance["candidate"]["name"].endswith("-detect"))
        self.assertTrue(provenance["complete_valid_responses"])

    def test_llm_engine_rejects_lexical_only_flag(self):
        argv = ["publish.py", "--pasuk-out", "unused.json", "--engine", "llm-detect", "--no-retype"]
        with mock.patch.object(publish.sys, "argv", argv), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                publish.main()

    def run_fake_encoder(self, tmp, device="cuda:0", dtype="float32", runtime="v1"):
        out = Path(tmp) / "rows.json"
        execution = {"device": device, "dtype": dtype, "tf32": False}
        entities_fn = mock.Mock(return_value=[])
        entities_fn.execution = dict(execution, gpu_name="test GPU")
        entities_fn.model_loaded = True
        sefarim, lexicon = fake_corpus()
        argv = [
            "publish.py", "--pasuk-out", str(out),
            "--checkpoint-dir", str(Path(tmp) / "cache"),
            "--device", device, "--dtype", dtype,
        ]
        with (
            mock.patch.object(publish.sys, "argv", argv),
            mock.patch.object(publish.baseline, "load_canonical", return_value=sefarim),
            mock.patch.object(publish.baseline, "load_lexicon", return_value=lexicon),
            mock.patch.object(publish.encoders, "normalize_execution", return_value=execution),
            mock.patch.object(publish.encoders, "runtime_signature", return_value={"torch": runtime}),
            mock.patch.object(publish.encoders, "lazy_entities_fn", return_value=entities_fn) as lazy,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            publish.main()
        lazy.assert_called_once_with(
            publish.resolve_retype_spec(publish.RETYPE_DEFAULT), device=device, dtype=dtype
        )
        return out, entities_fn

    def test_device_and_precision_changes_invalidate_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, cold = self.run_fake_encoder(tmp)
            cold.assert_called_once()
            cold_bytes = out.read_bytes()
            _, warm = self.run_fake_encoder(tmp)
            warm.assert_not_called()
            self.assertEqual(out.read_bytes(), cold_bytes)
            _, cpu = self.run_fake_encoder(tmp, device="cpu")
            cpu.assert_called_once()
            _, reduced = self.run_fake_encoder(tmp, dtype="float16")
            reduced.assert_called_once()
            _, upgraded = self.run_fake_encoder(tmp, dtype="float16", runtime="v2")
            upgraded.assert_called_once()

    def test_provenance_pins_model_backend_and_rows_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, _ = self.run_fake_encoder(tmp)
            provenance = json.loads(
                Path(f"{out}.provenance.json").read_text(encoding="utf-8")
            )
            self.assertEqual(provenance["rows_sha256"], hashlib.sha256(out.read_bytes()).hexdigest())
        self.assertEqual(
            provenance["candidate"]["revision"],
            publish.resolve_retype_spec(publish.RETYPE_DEFAULT)["revision"],
        )
        self.assertEqual(provenance["execution"]["device"], "cuda:0")
        self.assertEqual(provenance["execution"]["dtype"], "float32")
        self.assertFalse(provenance["execution"]["tf32"])
        self.assertTrue(provenance["model_loaded_this_run"])
        self.assertEqual(provenance["inference_runtime"], {"torch": "v1"})
        self.assertEqual(provenance["checkpoint"]["misses"], 1)

    def test_cuda_error_precedes_corpus_loading_or_weight_download(self):
        argv = ["publish.py", "--pasuk-out", "unused.json", "--device", "cuda"]
        with (
            mock.patch.object(publish.sys, "argv", argv),
            mock.patch.object(publish.encoders, "normalize_execution", side_effect=RuntimeError("CUDA unavailable")),
            mock.patch.object(publish.baseline, "load_canonical") as corpus,
            mock.patch.object(publish.encoders, "lazy_entities_fn") as lazy,
            contextlib.redirect_stderr(io.StringIO()),
        ):
            with self.assertRaises(SystemExit):
                publish.main()
        corpus.assert_not_called()
        lazy.assert_not_called()

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
