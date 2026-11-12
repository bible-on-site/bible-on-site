"""Keep speech letters separate from model-emitted direction controls."""

import unicodedata


# Unicode Bidi_Control; deliberately excludes joiners and language diacritics.
BIDI_CONTROLS = frozenset(chr(code) for code in (
    0x061C, 0x200E, 0x200F, *range(0x202A, 0x202F), *range(0x2066, 0x206A),
))
_BIDI_TRANSLATION = str.maketrans({character: None for character in BIDI_CONTROLS})


def strip_direction_controls(text: str) -> str:
    """Remove direction overrides from derived text, leaving every letter intact."""
    return text.translate(_BIDI_TRANSLATION)


def comparison_text(text: str) -> str:
    """Ignore punctuation and bidi formatting, preserving spelling and diacritics."""
    text = strip_direction_controls(unicodedata.normalize("NFKC", text).lower())
    return " ".join("".join(character for character in text
                            if unicodedata.category(character)[0] not in {"P", "S"}).split())
