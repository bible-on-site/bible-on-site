"""Local LLM safety, source-coordinate fidelity and provenance tests.

No weights, torch, external provider or database is needed for these tests.
"""

import copy
import contextlib
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

import local_llm as llm


def row(**changes):
    result = {"source_kind": "pasuk", "perek_id": 1, "pasuk_number": 1,
              "segment_start": 0, "segment_end": 0, "surface": "ישראל",
              "intended_name": "ישראל", "entity_type": "PERSON",
              "acceptance": "auto", "confidence": 1.0, "source_hash": "original"}
    return dict(result, **changes)


def respond(messages, **changes):
    candidates = json.loads(messages[-1]["content"])["candidates"]
    decisions = [candidate | {"decision": "accept"} | changes for candidate in candidates]
    return json.dumps({"decisions": decisions}, ensure_ascii=False)


class TestValidation(unittest.TestCase):
    def setUp(self):
        self.candidates = [{"id": 0, "surface": "ישראל", "span": [0, 0],
                            "intended_name": "ישראל", "entity_type": "PERSON"}]
        self.valid = {"decisions": [dict(self.candidates[0], decision="accept")]}

    def test_full_taxonomy_can_be_emitted_without_ner_label_mapping(self):
        for kind in llm.ENTITY_TYPES:
            with self.subTest(kind=kind):
                self.valid["decisions"][0]["entity_type"] = kind
                actual = llm.validate_output(json.dumps(self.valid), self.candidates)
                self.assertEqual(actual[0]["entity_type"], kind)

    def test_untrusted_output_cannot_change_identity_span_or_schema(self):
        changes = [{"id": 99}, {"id": False}, {"surface": "דוד"},
                   {"span": [0, 2]}, {"span": [False, 0]}, {"entity_type": "SQL"},
                   {"entity_type": []}, {"decision": []}, {"decision": "publish"},
                   {"intended_name": "<a>ישראל</a>"}, {"intended_name": "יִשְׂרָאֵל"},
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

    def test_mutable_model_revision_is_rejected_before_dependencies_or_download(self):
        with self.assertRaisesRegex(ValueError, "immutable"):
            llm.load_generate_fn(dict(llm.CANDIDATE, revision="main"))


class TestLocalLoading(unittest.TestCase):
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
                    mock.patch.dict("sys.modules", torch=types.SimpleNamespace(), transformers=transformers), \
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
        torch = types.SimpleNamespace(float32="fp32", inference_mode=contextlib.nullcontext)
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


if __name__ == "__main__":
    unittest.main()
