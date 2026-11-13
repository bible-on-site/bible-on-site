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
    """Normalize direction, quotes and separators, preserving spelling and diacritics."""
    text = strip_direction_controls(unicodedata.normalize("NFKC", text).lower())
    characters = []
    for character in text:
        category = unicodedata.category(character)
        # Quoted abbreviations such as tanakh stay one word; maqaf, hyphens
        # and other separator punctuation must not glue adjacent words.
        if character in {'"', "'", "\u05f3", "\u05f4"} or category in {"Pi", "Pf"}:
            continue
        characters.append(" " if category[0] in {"P", "S"} else character)
    return " ".join("".join(characters).split())
