"""Test local LLM safety, source-coordinate fidelity and provenance."""

# Tests need no weights, torch, external provider or database.

import copy
import contextlib
import json
from pathlib import Path
import tempfile
import types
import unittest
import unittest.mock

import local_llm as llm

mock = unittest.mock


def row(**changes):
    result = {"source_kind": "pasuk", "perek_id": 1, "pasuk_number": 1,
              "segment_start": 0, "segment_end": 0, "surface": "ישראל",
              "intended_name": "ישראל", "entity_type": "PERSON",
              "acceptance": "auto", "confidence": 1.0, "source_hash": "original"}
    return dict(result, **changes)


def respond(messages, **changes):
    candidates = json.loads(messages[-1]["content"])["candidates"]
    decisions = [{key: candidate[key] for key in ("id", "intended_name", "entity_type")}
                 | {"decision": "accept"} | changes for candidate in candidates]
    return json.dumps({"decisions": decisions}, ensure_ascii=False)


class TestValidation(unittest.TestCase):
    def setUp(self):
        self.candidates = [{"id": 0, "surface": "ישראל", "span": [0, 0],
                            "intended_name": "ישראל", "entity_type": "PERSON"}]
        self.valid = {"decisions": [{"id": 0, "intended_name": "ישראל",
                                     "entity_type": "PERSON", "decision": "accept"}]}

    def test_full_taxonomy_can_be_emitted_without_ner_label_mapping(self):
        for kind in llm.ENTITY_TYPES:
            with self.subTest(kind=kind):
                self.valid["decisions"][0]["entity_type"] = kind
                actual = llm.validate_output(json.dumps(self.valid), self.candidates)
                self.assertEqual(actual[0]["entity_type"], kind)

    def test_untrusted_output_cannot_change_identity_span_or_schema(self):
        changes = [{"id": 99}, {"id": False}, {"surface": "דוד"}, {"surface": "ישראל"},
                   {"span": [0, 0]}, {"span": [0, 2]}, {"span": [False, 0]}, {"entity_type": "SQL"},
                   {"entity_type": []}, {"decision": []}, {"decision": "publish"},
                   {"intended_name": "<a>ישראל</a>"},
                   {"intended_name": ""}, {"confidence": 1}]
        for change in changes:
            with self.subTest(change=change):
                output = copy.deepcopy(self.valid)
                output["decisions"][0].update(change)
                with self.assertRaises(ValueError):
                    llm.validate_output(json.dumps(output), self.candidates)

    def test_missing_duplicate_and_non_json_outputs_rejected(self):
        for output in ["not json", "[]", "null", '{"decisions":[]}',
                       json.dumps({"decisions": self.valid["decisions"] * 2}),
                       json.dumps(dict(self.valid, sql="DROP TABLE x"))]:
            with self.subTest(output=output), self.assertRaises(ValueError):
                llm.validate_output(output, self.candidates)

    def test_target_keys_normalize_format_without_removing_letters_or_prefixes(self):
        variants = {
            "דָּֽן": "דן", "הַגִּלְעָ֖ד": "הגלעד", "וּבְדָן": "ובדן",
            "\u200bבֵּית\u200d־אֵל\ufeff": "בית אל", "  בֵּית--אֵל  ": "בית אל",
            "מִצְרַיְמָה": "מצרימה",
        }
        for original, canonical in variants.items():
            with self.subTest(original=original):
                output = copy.deepcopy(self.valid)
                output["decisions"][0]["intended_name"] = original
                raw = json.dumps(output, ensure_ascii=False)
                actual = llm.validate_output(raw, self.candidates)
                self.assertEqual(actual[0]["intended_name"], canonical)
                self.assertEqual(json.loads(raw)["decisions"][0]["intended_name"], original)

    def test_target_key_normalization_still_rejects_malformed_names(self):
        bad_names = [None, False, 123, [], {}, "", " ", "\u0591\u05b0\u200b",
                     "א" * 121, "<דוד>", "דוד\x00", "דוד\n", "דוד\x7f", "\x85דוד",
                     "דוד\ud800", "דוד\udfff", "OTHER"]
        for value in bad_names:
            with self.subTest(value=value), self.assertRaises(ValueError):
                llm.normalize_model_name(value)


class TestRetype(unittest.TestCase):
    def setUp(self):
        self.perek = {"perekId": 1, "pesukim": [{"segments": [
            {"type": "qri", "value": "ישראל"}, {"type": "qri", "value": "יצאו"}]}]}

    def test_context_changes_type_without_modifying_original_source(self):
        original = row()
        source = copy.deepcopy(self.perek)

        def generate(messages):
            self.assertIn("ישראל יצאו", messages[-1]["content"])
            return respond(messages, entity_type="NATION")
        result = llm.retype_perek_rows(self.perek, [original], generate, "pinned")
        self.assertEqual(result[0]["entity_type"], "NATION")
        self.assertEqual(result[0]["model_revision"], "pinned")
        for key in ("surface", "source_hash", "segment_start", "segment_end"):
            self.assertEqual(result[0][key], original[key])
        self.assertEqual(original["entity_type"], "PERSON")
        self.assertEqual(self.perek, source)

    def test_invalid_or_abstained_output_holds_and_reject_does_not_render(self):
        for generate, acceptance in [(lambda _: "{not json", "held"),
                                     (lambda messages: respond(messages, decision="abstain"), "held"),
                                     (lambda messages: respond(messages, decision="reject"), "rejected")]:
            with self.subTest(acceptance=acceptance):
                result = llm.retype_perek_rows(self.perek, [row()], generate)
                self.assertEqual(result[0]["acceptance"], acceptance)

    def test_held_and_manual_decisions_cannot_be_promoted(self):
        generate = mock.Mock(side_effect=respond)
        rows = [row(acceptance="held"), row(acceptance="manual"), row(acceptance="rejected")]
        result = llm.retype_perek_rows(self.perek, rows, generate)
        self.assertEqual([item["acceptance"] for item in result], ["held", "manual", "rejected"])
        candidates = json.loads(generate.call_args.args[0][-1]["content"])["candidates"]
        self.assertEqual(len(candidates), 1)

    def test_no_candidates_does_not_load_or_call_model(self):
        generate = mock.Mock()
        self.assertEqual(llm.retype_perek_rows(self.perek, [], generate), [])
        generate.assert_not_called()

    def test_oversized_context_abstains_without_silent_truncation(self):
        self.perek["pesukim"][0]["segments"][1]["value"] = "א" * llm.MAX_CONTEXT_CHARS
        generate = mock.Mock()
        output = llm.retype_perek_rows(self.perek, [row()], generate)
        generate.assert_not_called()
        self.assertEqual(output[0]["acceptance"], "held")

    def test_article_preserves_utf16_coordinates_and_skips_stale_or_anchor_spans(self):
        content = "<p>😀 ישראל יצאו</p><a href='/x'>דוד</a>"
        original = row(source_kind="article", span_start=6, span_end=11)
        output = llm.retype_article_rows(content, [original], lambda messages: respond(messages, entity_type="NATION"))
        self.assertEqual(output[0]["entity_type"], "NATION")
        self.assertEqual((output[0]["span_start"], output[0]["span_end"]), (6, 11))
        generate = mock.Mock()
        stale = llm.retype_article_rows(content, [dict(original, surface="דוד")], generate)
        self.assertEqual(stale[0]["acceptance"], "held")
        generate.assert_not_called()

    def test_lean_decision_preserves_vocalized_article_surface_and_utf16_coordinates(self):
        surface = "יִשְׂרָאֵל"
        content = f"<p>😀 {surface}</p>"
        original = row(source_kind="article", surface=surface, span_start=6,
                       span_end=6 + len(surface))
        responses = []

        def generate(messages):
            response = respond(messages, entity_type="NATION")
            responses.append(json.loads(response)["decisions"][0])
            return response

        actual = llm.retype_article_rows(content, [original], generate)[0]
        self.assertEqual(set(responses[0]), llm.DECISION_FIELDS)
        self.assertNotIn("surface", responses[0])
        self.assertNotIn("span", responses[0])
        self.assertEqual(actual["surface"], surface)
        self.assertEqual((actual["span_start"], actual["span_end"]), (6, 6 + len(surface)))
        encoded = content.encode("utf-16-le")
        self.assertEqual(encoded[actual["span_start"] * 2:actual["span_end"] * 2].decode("utf-16-le"), surface)

    def test_article_candidates_in_one_text_run_share_bounded_request(self):
        content = "<p>ישראל ומשה</p>"
        first = row(source_kind="article", span_start=3, span_end=8)
        second = row(source_kind="article", surface="ומשה", intended_name="משה", span_start=9, span_end=13)
        generate = mock.Mock(side_effect=respond)
        actual = llm.retype_article_rows(content, [first, second], generate)
        self.assertEqual(len(actual), 2)
        self.assertEqual(generate.call_count, 1)
        self.assertEqual([value["surface"] for value in actual], ["ישראל", "ומשה"])

    def test_invalid_batch_reports_counts_without_storing_source_in_diagnostic(self):
        with tempfile.TemporaryDirectory() as directory:
            generator = llm.CachedGenerator(lambda _: "bad-json", directory, "pinned")
            llm.retype_perek_rows(self.perek, [row()], generator)
            self.assertEqual(generator.diagnostics["invalid_batches"], 1)
            self.assertEqual(generator.diagnostics["invalid_candidates"], 1)
            self.assertIn("invalid_reason:model output is not a JSON object", generator.diagnostics)


class TestProvenanceAndCache(unittest.TestCase):
    def test_output_normalization_versions_rows_and_cache_without_changing_generation(self):
        messages = llm.build_messages("ישראל", [{"id": 0, "surface": "ישראל", "span": [0, 0],
                                               "intended_name": "ישראל", "entity_type": "PERSON"}])
        schema = copy.deepcopy(llm.RETYPE_RESPONSE_SCHEMA)
        revision = llm.revision_tag()
        profile = llm.format_identity(schema)
        with mock.patch.object(llm, "OUTPUT_NORMALIZATION_VERSION", "target-key-next"):
            self.assertNotEqual(llm.revision_tag(), revision)
            self.assertIn("+target-key-next+", llm.revision_tag())
            self.assertNotEqual(llm.format_identity(schema), profile)
            self.assertEqual(llm.RETYPE_RESPONSE_SCHEMA, schema)
            self.assertEqual(messages, llm.build_messages("ישראל", [{"id": 0, "surface": "ישראל", "span": [0, 0],
                                                                      "intended_name": "ישראל", "entity_type": "PERSON"}]))

    def test_grammar_schema_and_library_changes_isolate_cache_identity(self):
        with mock.patch.object(llm.importlib.metadata, "version", return_value=llm.FORMAT_ENFORCER_PIN):
            plain = llm.revision_tag()
            structured = llm.revision_tag(constrained_json=True)
            self.assertNotEqual(plain, structured)
            with mock.patch.object(llm, "GRAMMAR_VERSION", "changed"):
                self.assertNotEqual(structured, llm.revision_tag(constrained_json=True))
            schema = copy.deepcopy(llm.RETYPE_RESPONSE_SCHEMA)
            schema["properties"]["decisions"]["maxItems"] += 1
            self.assertNotEqual(llm.format_identity(schema)["schema_sha256"],
                                llm.format_identity(llm.RETYPE_RESPONSE_SCHEMA)["schema_sha256"])
        with mock.patch.object(llm.importlib.metadata, "version", return_value="different"):
            self.assertNotEqual(structured, llm.revision_tag(constrained_json=True))

    def test_execution_and_prompt_change_revision(self):
        with mock.patch.object(llm.encoders, "runtime_signature", return_value={"tokenizers": "v1"}):
            cpu = llm.revision_tag(execution={"device": "cpu", "dtype": "float32"})
            cuda = llm.revision_tag(execution={"device": "cuda:0", "dtype": "bfloat16"})
            self.assertNotEqual(cpu, cuda)
            with mock.patch.object(llm, "PROMPT_VERSION", "changed"):
                self.assertNotEqual(cpu, llm.revision_tag(execution={"device": "cpu", "dtype": "float32"}))
        with mock.patch.object(llm.encoders, "runtime_signature", return_value={"tokenizers": "v2"}):
            self.assertNotEqual(cpu, llm.revision_tag(execution={"device": "cpu", "dtype": "float32"}))

    def test_cache_reuses_exact_request_and_isolates_model_revision(self):
        generate = mock.Mock(return_value='{"decisions":[]}')
        with tempfile.TemporaryDirectory() as directory:
            one = llm.CachedGenerator(generate, directory, "first")
            messages = [{"role": "user", "content": "ישראל"}]
            self.assertEqual(one(messages), one(messages))
            self.assertEqual(generate.call_count, 1)
            self.assertEqual((one.calls, one.cache_hits), (1, 1))
            two = llm.CachedGenerator(generate, directory, "second")
            two(messages)
            self.assertEqual(generate.call_count, 2)
            self.assertEqual(len(list(Path(directory).glob("*.json"))), 2)

    def test_corrupted_cache_is_regenerated_instead_of_permanent_abstention(self):
        with tempfile.TemporaryDirectory() as directory:
            generate = mock.Mock(return_value='{"decisions":[]}')
            cached = llm.CachedGenerator(generate, directory, "pinned")
            cached([])
            path = next(Path(directory).glob("*.json"))
            for broken in ("truncated{", "[]", "null"):
                path.write_text(broken, encoding="utf-8")
                self.assertEqual(cached([]), '{"decisions":[]}')
            self.assertEqual(generate.call_count, 4)

    def test_invalid_response_is_quarantined_and_next_attempt_recovers_without_force(self):
        calls = []

        def transient(messages):
            calls.append(messages)
            return "truncated-json{" if len(calls) == 1 else respond(messages, entity_type="NATION")

        perek = {"perekId": 1, "pesukim": [{"segments": [{"type": "qri", "value": "ישראל"}]}]}
        with tempfile.TemporaryDirectory() as directory:
            first = llm.CachedGenerator(transient, directory, "pinned")
            failed = llm.retype_perek_rows(perek, [row()], first)
            self.assertEqual(failed[0]["acceptance"], "held")
            self.assertEqual(list(Path(directory).glob("*.json")), [])
            evidence = list((Path(directory) / "invalid").glob("*.json"))
            outputs = [json.loads(path.read_text(encoding="utf-8")) for path in evidence]
            self.assertTrue(any(record.get("output") == "truncated-json{" for record in outputs))
            self.assertTrue(any(record.get("reason") == "model output is not a JSON object" for record in outputs))
            second = llm.CachedGenerator(transient, directory, "pinned")
            recovered = llm.retype_perek_rows(perek, [row()], second)
            self.assertEqual((recovered[0]["entity_type"], recovered[0]["acceptance"]), ("NATION", "auto"))
            self.assertEqual(second.calls, 1)
            llm.retype_perek_rows(perek, [row()], second)
            self.assertEqual(second.cache_hits, 1)
            self.assertEqual(len(calls), 2)
            self.assertEqual(first.diagnostics["invalid_batches"], 1)
            self.assertEqual(first.diagnostics["quarantined_responses"], 1)

    def test_invalidating_an_absent_request_is_a_noop(self):
        with tempfile.TemporaryDirectory() as directory:
            cached = llm.CachedGenerator(lambda _: "unused", directory, "pinned")
            self.assertIsNone(cached.invalidate([]))
            self.assertFalse((Path(directory) / "invalid").exists())

    def test_mutable_model_revision_is_rejected_before_dependencies_or_download(self):
        with self.assertRaisesRegex(ValueError, "immutable"):
            llm.load_generate_fn(dict(llm.CANDIDATE, revision="main"))


class TestLocalLoading(unittest.TestCase):
    def test_known_windows_cuda_wheel_cpu_crash_is_rejected_before_model_or_tokenizer_load(self):
        loaders = types.SimpleNamespace(
            AutoTokenizer=types.SimpleNamespace(from_pretrained=mock.Mock()),
            AutoModelForCausalLM=types.SimpleNamespace(from_pretrained=mock.Mock()))
        torch = types.SimpleNamespace(__version__="2.14.1+cu126")
        with (mock.patch.dict("sys.modules", torch=torch, transformers=loaders),
              mock.patch.object(llm.encoders.sys, "platform", "win32")):
            with self.assertRaisesRegex(RuntimeError, "CPU-only torch 2.15.0"):
                llm.load_generate_fn(device="cpu", dtype="float32")
        loaders.AutoTokenizer.from_pretrained.assert_not_called()
        loaders.AutoModelForCausalLM.from_pretrained.assert_not_called()

    def test_qwen_nf4_load_is_single_gpu_and_thinking_is_explicitly_disabled(self):
        tensor = mock.Mock()
        tensor.shape = [1, 5]
        tensor.to.return_value = tensor
        tokenizer = mock.Mock()
        tokenizer.return_value = {"input_ids": tensor}
        model = mock.Mock()
        transformers = types.SimpleNamespace(
            AutoTokenizer=types.SimpleNamespace(from_pretrained=mock.Mock(return_value=tokenizer)),
            AutoModelForCausalLM=types.SimpleNamespace(from_pretrained=mock.Mock(return_value=model)),
            BitsAndBytesConfig=mock.Mock(return_value="nf4-config"))
        torch = types.SimpleNamespace(
            bfloat16="bf16", set_float32_matmul_precision=mock.Mock(),
            cuda=types.SimpleNamespace(reset_peak_memory_stats=mock.Mock(), synchronize=mock.Mock(),
                                       max_memory_allocated=mock.Mock(return_value=1234)),
            backends=types.SimpleNamespace(cuda=types.SimpleNamespace(matmul=types.SimpleNamespace(allow_tf32=True)),
                                           cudnn=types.SimpleNamespace(allow_tf32=True)))
        execution = {"device": "cuda:0", "dtype": "bfloat16", "tf32": False}
        with mock.patch.dict("sys.modules", torch=torch, transformers=transformers), \
                mock.patch.object(llm.encoders, "normalize_execution", return_value=execution), \
                mock.patch.object(llm.encoders, "execution_provenance", return_value=dict(execution)):
            generate = llm.load_generate_fn(llm.MODEL_CANDIDATES["qwen3-8b-retype"])
            self.assertEqual(generate.count_input_tokens([]), 5)
            self.assertFalse(tokenizer.apply_chat_template.call_args.kwargs["enable_thinking"])
            options = transformers.AutoModelForCausalLM.from_pretrained.call_args.kwargs
            self.assertEqual(options["device_map"], {"": "cuda:0"})
            self.assertEqual(options["quantization_config"], "nf4-config")
            transformers.BitsAndBytesConfig.assert_called_once_with(
                load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype="bf16")
            model.to.assert_not_called()
            self.assertFalse(torch.backends.cuda.matmul.allow_tf32)
            self.assertFalse(torch.backends.cudnn.allow_tf32)
            self.assertEqual(generate.execution["quantization"], "nf4-double")
            self.assertEqual(generate.stats["cuda_peak_allocated_bytes"], 1234)

    def test_nf4_rejects_cpu_or_wrong_compute_precision_before_weights(self):
        for execution in [{"device": "cpu", "dtype": "bfloat16"},
                          {"device": "cuda:0", "dtype": "float32"}]:
            transformers = types.SimpleNamespace(AutoTokenizer=mock.Mock(), AutoModelForCausalLM=mock.Mock())
            with self.subTest(execution=execution), \
                    mock.patch.dict("sys.modules", torch=types.SimpleNamespace(__version__="test-torch"),
                                    transformers=transformers), \
                    mock.patch.object(llm.encoders, "normalize_execution", return_value=execution):
                with self.assertRaisesRegex(ValueError, "explicit CUDA"):
                    llm.load_generate_fn(llm.MODEL_CANDIDATES["qwen3-8b-retype"])
                transformers.AutoTokenizer.from_pretrained.assert_not_called()
                transformers.AutoModelForCausalLM.from_pretrained.assert_not_called()

    def test_pinned_loading_uses_chat_template_and_greedy_bounded_continuation(self):
        tensor = mock.Mock()
        tensor.shape = [1, 5]
        tensor.to.return_value = tensor
        tokenizer = mock.Mock()
        tokenizer.apply_chat_template.return_value = "rendered-chat"
        tokenizer.return_value = {"input_ids": tensor}
        tokenizer.pad_token_id = None
        tokenizer.eos_token_id = 7
        tokenizer.decode.return_value = '{"decisions":[]}'
        model = mock.Mock()
        model.to.return_value = model
        output = mock.MagicMock()
        output.__getitem__.return_value = [9, 7]
        model.generate.return_value = output
        transformers = types.SimpleNamespace(
            AutoTokenizer=types.SimpleNamespace(from_pretrained=mock.Mock(return_value=tokenizer)),
            AutoModelForCausalLM=types.SimpleNamespace(from_pretrained=mock.Mock(return_value=model)))
        torch = types.SimpleNamespace(__version__="test-torch", float32="fp32", inference_mode=contextlib.nullcontext)
        execution = {"device": "cpu", "dtype": "float32", "tf32": False}
        with mock.patch.dict("sys.modules", torch=torch, transformers=transformers), \
                mock.patch.object(llm.encoders, "normalize_execution", return_value=execution), \
                mock.patch.object(llm.encoders, "execution_provenance", return_value=execution):
            generate = llm.load_generate_fn(device="cpu", dtype="float32")
            messages = [{"role": "user", "content": "ישראל"}]
            self.assertEqual(generate(messages), '{"decisions":[]}')
            for loader in (transformers.AutoTokenizer.from_pretrained, transformers.AutoModelForCausalLM.from_pretrained):
                self.assertEqual(loader.call_args.kwargs["revision"], llm.CANDIDATE["revision"])
                self.assertFalse(loader.call_args.kwargs["trust_remote_code"])
            self.assertTrue(transformers.AutoModelForCausalLM.from_pretrained.call_args.kwargs["use_safetensors"])
            tokenizer.apply_chat_template.assert_called_once_with(messages, tokenize=False, add_generation_prompt=True)
            self.assertFalse(model.generate.call_args.kwargs["do_sample"])
            self.assertEqual(model.generate.call_args.kwargs["max_new_tokens"], llm.MAX_NEW_TOKENS)
            output.__getitem__.assert_called_once_with((0, slice(5, None)))
            tensor.shape = [1, llm.MAX_INPUT_TOKENS + 1]
            with self.assertRaisesRegex(ValueError, "no truncation"):
                generate(messages)
            self.assertEqual(model.generate.call_count, 1)


class TestResponseGrammar(unittest.TestCase):
    def test_retype_grammar_uses_only_supplied_candidate_indices_and_count(self):
        candidates = [{"id": 7, "span": [3, 5], "surface": "ישראל", "intended_name": "ישראל",
                       "entity_type": "PERSON"}]
        messages = llm.build_messages("ישראל יצאו", candidates)
        schema = llm.request_schema(llm.RETYPE_RESPONSE_SCHEMA, messages)
        array = schema["properties"]["decisions"]
        properties = array["items"]["properties"]
        self.assertEqual((array["minItems"], array["maxItems"]), (1, 1))
        self.assertEqual(properties["id"]["enum"], [7])
        self.assertNotIn("surface", properties)
        self.assertNotIn("span", properties)
        self.assertEqual(set(properties["entity_type"]["enum"]), llm.ENTITY_TYPES)
        self.assertEqual(set(array["items"]["required"]), llm.DECISION_FIELDS)
        self.assertFalse(array["items"]["additionalProperties"])

    def test_detect_grammar_uses_source_indices_and_full_taxonomy_plus_other(self):
        import llm_detect
        messages = llm_detect.build_messages("אריה שאג", [{"index": 8, "text": "אריה"},
                                                       {"index": 9, "text": "שאג"}])
        schema = llm.request_schema(llm_detect.DETECT_RESPONSE_SCHEMA, messages)
        array = schema["properties"]["mentions"]
        properties = array["items"]["properties"]
        self.assertEqual(properties["start"]["enum"], [8, 9])
        self.assertEqual(properties["end"]["enum"], [8, 9])
        self.assertNotIn("surface", properties)
        self.assertEqual(set(properties["entity_type"]["enum"]), llm.ENTITY_TYPES | {"OTHER"})
        self.assertEqual(set(array["items"]["required"]), llm_detect.MENTION_FIELDS)
        self.assertFalse(array["items"]["additionalProperties"])
        self.assertEqual(array["maxItems"], llm_detect.MAX_MENTIONS)

    def test_invalid_source_bounds_fail_before_generation(self):
        import llm_detect
        for value in ({"units": [{"index": True}]}, {"units": [{"index": -1}]},
                      {"units": []}, {"units": "bad"}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                llm.request_schema(llm_detect.DETECT_RESPONSE_SCHEMA,
                                   [{"role": "user", "content": json.dumps(value)}])

    def test_bound_profiles_share_weights_and_stats_and_use_fresh_prefix_state(self):
        import llm_detect
        tensor = mock.Mock()
        tensor.shape = [1, 5]
        tensor.to.return_value = tensor
        tokenizer = mock.MagicMock()
        tokenizer.__len__.return_value = 100
        tokenizer.return_value = {"input_ids": tensor}
        tokenizer.pad_token_id = 0
        tokenizer.eos_token_id = 7
        tokenizer.decode.return_value = '{"decisions":[]}'
        model = mock.Mock()
        model.to.return_value = model
        model.config = types.SimpleNamespace(vocab_size=90)
        output = mock.MagicMock()
        output.__getitem__.return_value = [8, 7]
        model.generate.return_value = output
        loaders = types.SimpleNamespace(
            AutoTokenizer=types.SimpleNamespace(from_pretrained=mock.Mock(return_value=tokenizer)),
            AutoModelForCausalLM=types.SimpleNamespace(from_pretrained=mock.Mock(return_value=model)))
        tokenizer_data = object()
        parsers = mock.Mock(side_effect=[object(), object()])
        configs = mock.Mock(side_effect=lambda **kwargs: kwargs)
        data_builder = mock.Mock(return_value=tokenizer_data)
        prefixes = [object(), object()]
        prefix_builder = mock.Mock(side_effect=prefixes)
        modules = {
            "torch": types.SimpleNamespace(__version__="test-torch", float32="fp32",
                                           inference_mode=contextlib.nullcontext),
            "transformers": loaders,
            "lmformatenforcer": types.SimpleNamespace(CharacterLevelParserConfig=configs, JsonSchemaParser=parsers),
            "lmformatenforcer.consts": types.SimpleNamespace(COMPLETE_ALPHABET='abc123 {}"'),
            "lmfe_transformers": types.SimpleNamespace(
                build_token_enforcer_tokenizer_data=data_builder,
                build_transformers_prefix_allowed_tokens_fn=prefix_builder),
        }
        execution = {"device": "cpu", "dtype": "float32", "tf32": False}
        with (
            mock.patch.dict("sys.modules", modules),
            mock.patch.object(llm.encoders, "normalize_execution", return_value=execution),
            mock.patch.object(llm.encoders, "execution_provenance", return_value=dict(execution)),
            mock.patch.object(llm.importlib.metadata, "version", return_value=llm.FORMAT_ENFORCER_PIN),
        ):
            base = llm.load_generate_fn(device="cpu", dtype="float32")
            original = copy.deepcopy(llm.RETYPE_RESPONSE_SCHEMA)
            retype = base.bind_schema(original)
            original["required"].append("mutated")
            self.assertNotIn("mutated", retype.response_schema["required"])
            detect = base.bind_schema(llm_detect.DETECT_RESPONSE_SCHEMA)
            messages = llm.build_messages("😀 יִשְׂרָאֵל", [{"id": 7, "surface": "יִשְׂרָאֵל", "span": [3, 5],
                                                           "intended_name": "ישראל", "entity_type": "PERSON"}])
            retype(messages)
            self.assertIs(model.generate.call_args.kwargs["prefix_allowed_tokens_fn"], prefixes[0])
            self.assertEqual(model.generate.call_args.kwargs["pad_token_id"], 0)
            detect(llm_detect.build_messages("אריה שאג", [{"index": 8, "text": "אריה"},
                                                       {"index": 9, "text": "שאג"}]))
            self.assertIs(model.generate.call_args.kwargs["prefix_allowed_tokens_fn"], prefixes[1])
            base(messages)
            self.assertNotIn("prefix_allowed_tokens_fn", model.generate.call_args.kwargs)
            self.assertIs(retype.stats, base.stats)
            self.assertIs(detect.stats, base.stats)
            self.assertEqual(base.stats["generated_requests"], 3)
            self.assertIs(retype.count_input_tokens, base.count_input_tokens)
            self.assertEqual(retype.execution["structured_output"]["library_pin"], llm.FORMAT_ENFORCER_PIN)
        loaders.AutoModelForCausalLM.from_pretrained.assert_called_once()
        loaders.AutoTokenizer.from_pretrained.assert_called_once()
        data_builder.assert_called_once_with(tokenizer, vocab_size=90)
        self.assertEqual(parsers.call_count, 2)
        alphabet = configs.call_args_list[0].kwargs["alphabet"]
        self.assertIn("ץ", alphabet)
        self.assertIn("֑", alphabet)
        self.assertIn("😀", alphabet)
        self.assertTrue(configs.call_args.kwargs["force_json_field_order"])
        self.assertEqual(parsers.call_args_list[0].args[0]["properties"]["decisions"]["items"]["properties"]["id"]["enum"], [7])


if __name__ == "__main__":
    unittest.main()
