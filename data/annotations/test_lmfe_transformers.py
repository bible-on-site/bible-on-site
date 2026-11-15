"""Test the LMFE core bridge without optional libraries or model weights."""

import types
import unittest
import unittest.mock

import lmfe_transformers as bridge

mock = unittest.mock


class _Sequence(list):
    def tolist(self):
        return list(self)


class TestRequestPolicy(unittest.TestCase):
    def setUp(self):
        self.instances = []
        instances = self.instances

        class OverwritingEnforcer:
            def __init__(self, data, parser):
                """Emulate LMFE 0.11.3 replacing the supplied parser policy."""
                self.data = data
                self.parser = parser
                self.prefixes = []
                parser.config = types.SimpleNamespace(
                    alphabet="ASCII", force_json_field_order=False,
                    max_consecutive_whitespaces=12,
                )
                instances.append(self)

            def get_allowed_tokens(self, prefix):
                self.prefixes.append(prefix)
                return types.SimpleNamespace(
                    allowed_tokens=[ord(char) for char in self.parser.config.alphabet]
                )

        self.enforcer = OverwritingEnforcer
        self.core = types.SimpleNamespace(TokenEnforcer=self.enforcer)

    def policy(self, alphabet="אְ😀", whitespace=2, ordered=True):
        return types.SimpleNamespace(
            alphabet=alphabet, max_consecutive_whitespaces=whitespace,
            force_json_field_order=ordered,
        )

    def test_fake_core_reproduces_the_upstream_configuration_overwrite(self):
        policy = self.policy()
        parser = types.SimpleNamespace(config=policy)
        self.enforcer(object(), parser)
        self.assertIsNot(parser.config, policy)
        self.assertEqual(parser.config.alphabet, "ASCII")
        self.assertEqual(parser.config.max_consecutive_whitespaces, 12)
        self.assertFalse(parser.config.force_json_field_order)

    def test_bridge_preserves_unicode_whitespace_and_field_order_policy(self):
        policy = self.policy()
        parser = types.SimpleNamespace(config=policy)
        data = object()
        with mock.patch.dict("sys.modules", {"lmformatenforcer": self.core}):
            allowed = bridge.build_transformers_prefix_allowed_tokens_fn(data, parser)
            tokens = allowed(0, _Sequence([10, 11]))
        self.assertIs(parser.config, policy)
        self.assertEqual(tokens, [ord("א"), ord("ְ"), ord("😀")])
        self.assertEqual(parser.config.max_consecutive_whitespaces, 2)
        self.assertTrue(parser.config.force_json_field_order)
        self.assertIs(self.instances[0].data, data)
        self.assertEqual(self.instances[0].prefixes, [[10, 11]])

    def test_shared_tokenizer_data_keeps_each_request_parser_and_history_isolated(self):
        data = object()
        first_policy = self.policy()
        second_policy = self.policy(alphabet="ב֑", whitespace=4, ordered=False)
        first_parser = types.SimpleNamespace(config=first_policy)
        second_parser = types.SimpleNamespace(config=second_policy)
        with mock.patch.dict("sys.modules", {"lmformatenforcer": self.core}):
            first = bridge.build_transformers_prefix_allowed_tokens_fn(data, first_parser)
            second = bridge.build_transformers_prefix_allowed_tokens_fn(data, second_parser)
            self.assertEqual(first(0, _Sequence([1])), [ord(char) for char in first_policy.alphabet])
            self.assertEqual(second(0, _Sequence([9])), [ord(char) for char in second_policy.alphabet])
            first(1, _Sequence([1, 2]))
        self.assertEqual(len(self.instances), 2)
        self.assertIs(self.instances[0].data, self.instances[1].data)
        self.assertIs(first_parser.config, first_policy)
        self.assertIs(second_parser.config, second_policy)
        self.assertEqual(self.instances[0].prefixes, [[1], [1, 2]])
        self.assertEqual(self.instances[1].prefixes, [[9]])
        self.assertEqual(second_parser.config.max_consecutive_whitespaces, 4)
        self.assertFalse(second_parser.config.force_json_field_order)


class _Tokenizer:
    all_special_ids = [0, 5]
    eos_token_id = 5

    def __init__(self):
        """Provide a tiny tokenizer with word starts and partial UTF-8 pieces."""
        self.calls = []

    def __len__(self):
        return 6

    def encode(self, text):
        return [1] if text == "0" else []

    def decode(self, identities, *, clean_up_tokenization_spaces):
        self.calls.append((list(identities), clean_up_tokenization_spaces))
        values = {
            (1,): "0", (2,): "\ufffd", (3,): "word", (4,): "\ufffd",
            (1, 1): "00", (1, 2): "0\ufffd", (1, 3): "0 word", (1, 4): "0\ufffd",
            (2, 4): "ש", (2, 2): "\ufffd\ufffd", (4, 2): "\ufffdש",
        }
        return values[tuple(identities)]


class TestTokenizerData(unittest.TestCase):
    def setUp(self):
        self.tokenizer = _Tokenizer()
        self.constructor = mock.Mock(side_effect=lambda regular, decode, eos, bitmask, size:
                                     types.SimpleNamespace(regular=regular, decode=decode,
                                                           eos=eos, bitmask=bitmask, size=size))
        self.core = types.SimpleNamespace(TokenEnforcerTokenizerData=self.constructor)

    def test_special_tokens_are_excluded_and_word_start_metadata_is_preserved(self):
        with mock.patch.dict("sys.modules", {"lmformatenforcer": self.core}):
            data = bridge.build_token_enforcer_tokenizer_data(self.tokenizer)
        self.assertEqual([identity for identity, _text, _start in data.regular], [1, 2, 3, 4])
        self.assertEqual(data.regular[2], (3, " word", True))
        self.assertEqual(data.regular[0], (1, "0", False))
        self.assertEqual((data.eos, data.bitmask, data.size), (5, False, 6))
        self.assertTrue(all(cleanup is False for _ids, cleanup in self.tokenizer.calls))

    def test_partial_utf8_is_deferred_until_complete_and_internal_errors_are_preserved(self):
        with mock.patch.dict("sys.modules", {"lmformatenforcer": self.core}):
            data = bridge.build_token_enforcer_tokenizer_data(self.tokenizer)
        self.assertEqual(data.decode([2]), "")
        self.assertEqual(data.decode([2, 2]), "")
        self.assertEqual(data.decode([2, 4]), "ש")
        self.assertEqual(data.decode([4, 2]), "\ufffdש")

    def test_model_vocabulary_bound_excludes_out_of_range_token_ids(self):
        with mock.patch.dict("sys.modules", {"lmformatenforcer": self.core}):
            data = bridge.build_token_enforcer_tokenizer_data(self.tokenizer, vocab_size=4)
        self.assertEqual([identity for identity, _text, _start in data.regular], [1, 2, 3])
        self.assertEqual(data.size, 4)

    def test_invalid_vocabulary_bounds_fail_before_tokenizer_work(self):
        with mock.patch.dict("sys.modules", {"lmformatenforcer": self.core}):
            for value in (0, -1, 7, True, "5"):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    bridge.build_token_enforcer_tokenizer_data(self.tokenizer, vocab_size=value)
        self.assertEqual(self.tokenizer.calls, [])
        self.constructor.assert_not_called()


if __name__ == "__main__":
    unittest.main()
