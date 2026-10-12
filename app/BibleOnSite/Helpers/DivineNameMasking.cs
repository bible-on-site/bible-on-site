using System.Globalization;
using System.Text;

namespace BibleOnSite.Helpers;

/// <summary>
/// Per-name display options for הסתר שם השם. The allowed subset differs per name
/// (no as-is for יהוה, no custom for אל) and is enforced by the UI and by
/// <see cref="Services.PreferencesService"/>.
/// </summary>
public enum DivineNameMaskOption
{
    /// <summary>אלהים/אל/שדי — show the canonical form.</summary>
    AsIs,
    /// <summary>אלקים family — ה→ק inside the stem.</summary>
    Elokim,
    /// <summary>א-להים / א-ל / שד-י — hyphen after the first stem letter.</summary>
    Hyphen,
    /// <summary>יהוה shown as ה'.</summary>
    Heh,
    /// <summary>יהוה shown as ד'.</summary>
    Dalet,
    /// <summary>User-provided replacement text (אחר).</summary>
    Custom,
}

/// <summary>
/// Immutable snapshot of the masking preferences, built by
/// <see cref="Services.PreferencesService.GetDivineNameMaskingOptions"/>.
/// </summary>
public sealed record DivineNameMaskingOptions(
    bool Enabled,
    DivineNameMaskOption Elohim,
    string ElohimCustom,
    DivineNameMaskOption Yhwh,
    string YhwhCustom,
    DivineNameMaskOption El,
    DivineNameMaskOption Shaddai,
    string ShaddaiCustom)
{
    public static readonly DivineNameMaskingOptions Disabled = new(
        Enabled: false,
        Elohim: DivineNameMaskOption.Hyphen, ElohimCustom: "",
        Yhwh: DivineNameMaskOption.Heh, YhwhCustom: "",
        El: DivineNameMaskOption.AsIs,
        Shaddai: DivineNameMaskOption.AsIs, ShaddaiCustom: "");
}

/// <summary>
/// Divine-name display masking (הסתר שם השם) — pure matching + transform.
///
/// Presentation-layer only: canonical <see cref="Models.Pasuk.Text"/> and segment
/// values are never mutated, so navigation, search, highlighting and recitation
/// alignment — all keyed on segment identity — are unaffected.
///
/// Matching policy (mirrored by the website's src/lib/divine-name-masking.ts —
/// keep both in sync):
///
/// - A candidate is a single whitespace-delimited word. Trailing punctuation
///   (paseq ׀, maqaf ־, sof pasuk ׃, spaces) is stripped for matching and
///   re-appended untouched. Words containing any non-Hebrew,
///   non-combining-mark character in their body are never matched.
/// - Matching compares base Hebrew letters only (NFD); niqqud, taamim and other
///   combining marks are ignored for letter comparison and dropped from the
///   output so no orphaned marks are left behind.
/// - Attached clitic prefixes are preserved (as bare letters) ahead of the
///   replacement:
///     יהוה / אלהים-family / שדי: one or two letters from ו ב כ ל מ ה ש
///       (covers ובאלהים, מהאלהים, ולה', שה' …)
///     אל: one letter from ו ב כ ל מ ה, or ו followed by one of ב כ ל מ ה
///       (deliberately excludes ש — שאל/שמואל must not match — and excludes
///       non-ו double prefixes so הואל "the tent" cannot match).
/// - יהוה matches when the remaining letters are exactly יהוה.
/// - אלהים-family matches three stems with closed, corpus-verified suffix
///   inventories (inflected and Aramaic forms):
///     אלהי + {∅, ם, ו, ך, יך, כם, כן, נו, ה, הו, הם, הן, מו}
///     אלוה + {∅, י, יך, יו, יכם, יכן, ינו, ה, הו, הם, הן}
///     אלה  + {א, יא, ה, הם, הון, ין, ך, כם, כון, ו, הו, נא}   (never bare —
///       אֵלֶּה "these" must not match)
/// - אל matches only the exact letters אל after the prefix, and only when the
///   aleph carries tzeire (אֵל) or is unpointed. Pointed אֶל/אַל/אֲל
///   ("to"/"don't") never match. Known documented homograph limitation:
///   unpointed אל and אֵל demonstratives ("these") are masked too.
/// - שדי matches the exact letters שדי only when ש has no sin dot (excludes
///   שְׂדֵי "my fields") and either ד bears dagesh or the word is fully
///   unpointed (unpointed שדי is masked — unpointed שָׂדַי is an accepted
///   false positive, same documented ambiguity).
/// - Replacement styles apply to the matched stem letters (prefix and suffix
///   letters are kept bare; all marks are dropped):
///     Elokim: first ה of the stem becomes ק; when the stem ends in ה
///       (אלוה/אלה), an ה is appended so אלוה→אלוקה. Suffixes are kept:
///       אלוהינו→אלוקינו.
///     Hyphen: an ASCII hyphen after the first stem letter (א-להים, א-ל, שד-י).
///     Heh/Dalet: ה'/ד' replace the whole יהוה stem.
///     Custom: user text replaces the whole stem; prefix/suffix letters kept.
///       Blank custom text leaves the word untouched for that name.
/// </summary>
public static class DivineNameMasking
{
    private static DivineNameMaskingOptions _current = DivineNameMaskingOptions.Disabled;
    private static int _revision;

    /// <summary>
    /// The ambient options applied by renderers that cannot take parameters
    /// (e.g. <see cref="Models.Pasuk.FormattedText"/>). PreferencesService keeps
    /// this in sync on load and on every change.
    /// </summary>
    public static DivineNameMaskingOptions Current => _current;

    /// <summary>
    /// Monotonic counter bumped whenever <see cref="Apply"/> installs different
    /// options — used by cached renderings (FormattedText) to rebuild lazily.
    /// </summary>
    public static int Revision => _revision;

    /// <summary>Installs the ambient options; bumps <see cref="Revision"/> on change.</summary>
    public static void Apply(DivineNameMaskingOptions options)
    {
        if (_current == options)
        {
            return;
        }

        _current = options;
        _revision++;
    }

    /// <summary>
    /// Test helper: installs options for the scope of the returned disposable and
    /// restores the previous ones on Dispose.
    /// </summary>
    public static IDisposable Scope(DivineNameMaskingOptions options)
    {
        var previous = _current;
        Apply(options);
        return new RestoreScope(previous);
    }

    private sealed class RestoreScope(DivineNameMaskingOptions previous) : IDisposable
    {
        public void Dispose() => Apply(previous);
    }

    private const char Maqaf = '־';

    /// <summary>Hebrew niqqud vowel points (sheva..hataf qamats, qamats qatan).</summary>
    private static bool IsNiqqud(char c) => c is >= '\u05b0' and <= '\u05bd' or '\u05c7';
    private const char Tzeire = '\u05b5';
    private const char Dagesh = '\u05bc';
    private const char SinDot = '\u05c2';

    private static bool IsHebrewLetter(char c) => c is >= 'א' and <= 'ת';
    private static bool IsMark(char c) =>
        CharUnicodeInfo.GetUnicodeCategory(c) is UnicodeCategory.NonSpacingMark
            or UnicodeCategory.SpacingCombiningMark;

    private const string Clitics = "ובכלמהש";
    private const string ElClitics = "ובכלמה";

    private static readonly Dictionary<string, HashSet<string>> ElohimStemSuffixes = new()
    {
        ["אלהי"] = ["", "ם", "ו", "ך", "יך", "כם", "כן", "נו", "ה", "הו", "הם", "הן", "מו"],
        ["אלוה"] = ["", "י", "יך", "יו", "יכם", "יכן", "ינו", "ה", "הו", "הם", "הן"],
        ["אלה"] = ["א", "יא", "ה", "הם", "הון", "ין", "ך", "כם", "כון", "ו", "הו", "נא"],
    };

    private readonly record struct LetterMarks(char Letter, string Marks);

    private sealed record Match(string Key, string Prefix, string Stem, string Suffix, string Tail);

    /// <summary>
    /// Parses "pointed" text into base letters with their combining marks.
    /// Returns null when the body holds anything else (spaces, punctuation,
    /// digits) — such words can never be a divine name.
    /// </summary>
    private static List<LetterMarks>? ParseLetters(string text)
    {
        var letters = new List<LetterMarks>();
        foreach (var ch in text.Normalize(NormalizationForm.FormD))
        {
            if (IsHebrewLetter(ch))
            {
                letters.Add(new LetterMarks(ch, ""));
            }
            else if (IsMark(ch) && letters.Count > 0)
            {
                var last = letters[^1];
                letters[^1] = last with { Marks = last.Marks + ch };
            }
            else
            {
                return null;
            }
        }
        return letters.Count > 0 ? letters : null;
    }

    /// <summary>Splits trailing non-Hebrew punctuation (paseq/maqaf/sof pasuk/space).</summary>
    private static (string Body, string Tail) SplitTail(string value)
    {
        var cut = value.Length;
        while (cut > 0 && !IsHebrewLetter(value[cut - 1]) && !IsMark(value[cut - 1]))
        {
            cut--;
        }
        return (value[..cut], value[cut..]);
    }

    private static IEnumerable<string> CliticPrefixes(bool forEl)
    {
        var singles = forEl ? ElClitics : Clitics;
        yield return "";
        foreach (var c in singles)
        {
            yield return c.ToString();
        }
        if (forEl)
        {
            foreach (var second in "בכלמה")
            {
                yield return $"ו{second}";
            }
        }
        else
        {
            foreach (var first in Clitics)
            {
                foreach (var second in Clitics)
                {
                    yield return $"{first}{second}";
                }
            }
        }
    }

    private static bool MatchesEl(List<LetterMarks> letters, int stemStart)
    {
        var aleph = letters[stemStart];
        if (aleph.Marks.Contains(Tzeire))
        {
            return true;
        }
        // Unpointed אל is treated as the name; any other vowel point
        // (אֶל/אַל/אֲל) is a different word.
        return !aleph.Marks.Any(IsNiqqud);
    }

    private static bool MatchesShaddai(List<LetterMarks> letters, int stemStart)
    {
        var shin = letters[stemStart];
        var dalet = letters[stemStart + 1];
        var yod = letters[stemStart + 2];
        if (shin.Marks.Contains(SinDot))
        {
            return false;
        }
        if (dalet.Marks.Contains(Dagesh))
        {
            return true;
        }
        // Unpointed שדי is masked; a pointed שדי whose ד lacks dagesh
        // (שָׂדַי/שָׁדַי "my field") is not.
        return !(shin.Marks + dalet.Marks + yod.Marks).Any(IsNiqqud);
    }

    private static Match? MatchWord(string value)
    {
        var (body, tail) = SplitTail(value);
        var letters = ParseLetters(body);
        if (letters is null)
        {
            return null;
        }
        var word = string.Concat(letters.Select(l => l.Letter));

        foreach (var prefix in CliticPrefixes(forEl: false))
        {
            if (!word.StartsWith(prefix, StringComparison.Ordinal))
            {
                continue;
            }
            if (word[prefix.Length..] == "יהוה")
            {
                return new Match("yhwh", prefix, "יהוה", "", tail);
            }
        }
        foreach (var prefix in CliticPrefixes(forEl: false))
        {
            if (!word.StartsWith(prefix, StringComparison.Ordinal))
            {
                continue;
            }
            var rest = word[prefix.Length..];
            // Longest stems first so אלהים parses as אלהי+ם, never אלה+ים.
            foreach (var stem in ElohimStemSuffixes.Keys.OrderByDescending(s => s.Length))
            {
                if (rest.StartsWith(stem, StringComparison.Ordinal) &&
                    ElohimStemSuffixes[stem].Contains(rest[stem.Length..]))
                {
                    return new Match("elohim", prefix, stem, rest[stem.Length..], tail);
                }
            }
        }
        foreach (var prefix in CliticPrefixes(forEl: true))
        {
            if (!word.StartsWith(prefix, StringComparison.Ordinal))
            {
                continue;
            }
            if (word[prefix.Length..] == "אל" && MatchesEl(letters, prefix.Length))
            {
                return new Match("el", prefix, "אל", "", tail);
            }
        }
        foreach (var prefix in CliticPrefixes(forEl: false))
        {
            if (!word.StartsWith(prefix, StringComparison.Ordinal))
            {
                continue;
            }
            if (word[prefix.Length..] == "שדי" && MatchesShaddai(letters, prefix.Length))
            {
                return new Match("shaddai", prefix, "שדי", "", tail);
            }
        }
        return null;
    }

    /// <summary>אלוהים→אלקים convention: first ה→ק; a stem-final ה is restored after it.</summary>
    private static string ElokimStem(string stem)
    {
        var heh = stem.IndexOf('ה');
        var replaced = $"{stem[..heh]}ק{stem[(heh + 1)..]}";
        return heh == stem.Length - 1 ? $"{replaced}ה" : replaced;
    }

    private static string? MaskStem(Match match, DivineNameMaskingOptions settings) =>
        match.Key switch
        {
            "yhwh" => settings.Yhwh switch
            {
                DivineNameMaskOption.Heh => "ה'",
                DivineNameMaskOption.Dalet => "ד'",
                _ => settings.YhwhCustom.Trim() is { Length: > 0 } custom ? custom : null,
            },
            "elohim" => settings.Elohim switch
            {
                DivineNameMaskOption.AsIs => null,
                DivineNameMaskOption.Elokim => ElokimStem(match.Stem),
                DivineNameMaskOption.Hyphen => $"{match.Stem[0]}-{match.Stem[1..]}",
                _ => settings.ElohimCustom.Trim() is { Length: > 0 } custom ? custom : null,
            },
            "el" => settings.El == DivineNameMaskOption.Hyphen ? "א-ל" : null,
            "shaddai" => settings.Shaddai switch
            {
                DivineNameMaskOption.AsIs => null,
                DivineNameMaskOption.Hyphen => "שד-י",
                _ => settings.ShaddaiCustom.Trim() is { Length: > 0 } custom ? custom : null,
            },
            _ => null,
        };

    /// <summary>
    /// Masks a single segment value when it is a divine name and masking is
    /// enabled for it; otherwise returns the value unchanged. Safe for ptuha/
    /// stuma markers too — they never match. Uses the ambient options.
    /// </summary>
    public static string MaskValue(string? value) => MaskValue(value, _current);

    /// <summary>
    /// Masks a single segment value under explicit options (test/policy path —
    /// renderers use the ambient overload).
    /// </summary>
    public static string MaskValue(string? value, DivineNameMaskingOptions options)
    {
        var settings = options;
        if (!settings.Enabled || string.IsNullOrEmpty(value))
        {
            return value ?? "";
        }
        var match = MatchWord(value);
        if (match is null)
        {
            return value;
        }
        var stem = MaskStem(match, settings);
        return stem is null ? value : match.Prefix + stem + match.Suffix + match.Tail;
    }

    /// <summary>
    /// Masks every divine-name word in a multi-word string using the ambient
    /// options. Splits on spaces and maqaf so maqaf-joined compounds are
    /// handled word-by-word; non-matching pieces pass through untouched.
    /// </summary>
    public static string MaskText(string? text) => MaskText(text, _current);

    /// <summary>
    /// Masks every divine-name word in a multi-word string under explicit
    /// options (test/policy path — renderers use the ambient overload).
    /// </summary>
    public static string MaskText(string? text, DivineNameMaskingOptions options)
    {
        var settings = options;
        if (!settings.Enabled || string.IsNullOrEmpty(text))
        {
            return text ?? "";
        }
        var builder = new StringBuilder(text.Length);
        foreach (var piece in SplitKeeping(text, ' ', Maqaf))
        {
            builder.Append(piece.Length is 1 && (piece[0] is ' ' or Maqaf)
                ? piece
                : MaskValue(piece, settings));
        }
        return builder.ToString();
    }

    private static IEnumerable<string> SplitKeeping(string text, params char[] separators)
    {
        var start = 0;
        for (var i = 0; i < text.Length; i++)
        {
            if (!separators.Contains(text[i]))
            {
                continue;
            }
            if (i > start)
            {
                yield return text[start..i];
            }
            yield return text[i].ToString();
            start = i + 1;
        }
        if (text.Length > start)
        {
            yield return text[start..];
        }
    }
}
