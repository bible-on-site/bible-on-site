"""Minimal LMFE core bridge for current Transformers tokenizers."""

# Adapted from lm-format-enforcer 0.11.3 integrations/transformers.py.
# Copyright (c) 2023 Noam Gat. MIT license: licenses/lm-format-enforcer.txt.
# Only token decoding and prefix filtering are needed. The upstream adapter
# imports a removed Transformers path and includes unrelated model patches.

ADAPTER_VERSION = "transformers5-core-v2-config"


def build_token_enforcer_tokenizer_data(tokenizer, *, vocab_size=None):
    """Build immutable token data once using the tokenizer's public API."""
    from lmformatenforcer import TokenEnforcerTokenizerData

    size = len(tokenizer) if vocab_size is None else vocab_size
    if isinstance(size, bool) or not isinstance(size, int) or not 0 < size <= len(tokenizer):
        raise ValueError("grammar vocabulary must fit the tokenizer and model")
    prefix = tokenizer.encode("0")[-1]
    special = set(tokenizer.all_special_ids)
    regular = []
    for identity in range(size):
        if identity in special:
            continue
        after_prefix = tokenizer.decode(
            [prefix, identity], clean_up_tokenization_spaces=False
        )[1:]
        alone = tokenizer.decode([identity], clean_up_tokenization_spaces=False)
        regular.append((identity, after_prefix, len(after_prefix) > len(alone)))

    def decode(identities):
        # A token can end halfway through a UTF-8 character. LMFE waits for
        # the following token instead of treating replacement glyphs as text.
        return tokenizer.decode(identities, clean_up_tokenization_spaces=False).rstrip("\ufffd")

    return TokenEnforcerTokenizerData(
        regular, decode, tokenizer.eos_token_id, False, size
    )


def build_transformers_prefix_allowed_tokens_fn(tokenizer_data, parser):
    """Create isolated request state for model.generate prefix filtering."""
    from lmformatenforcer import TokenEnforcer

    config = parser.config
    enforcer = TokenEnforcer(tokenizer_data, parser)
    # LMFE 0.11.3 replaces this with tokenizer-root characters and default
    # limits. Preserve the explicit source Unicode, whitespace and field-order
    # policy used to create this request's parser.
    parser.config = config

    def allowed_tokens(_batch_id, sequence):
        return enforcer.get_allowed_tokens(sequence.tolist()).allowed_tokens

    return allowed_tokens
