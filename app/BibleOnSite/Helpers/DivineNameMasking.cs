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

    /// <summary>Longest divine-name letter form: 2 clitics + 4 stem + 3 suffix letters.</summary>
    private const int MaxFormLetters = 9;

    private enum DivineNameKind : byte { Yhwh, Elohim, El, Shaddai }

    /// <summary>Where a matched letter form splits into clitic prefix / stem / suffix.</summary>
    private readonly record struct NameForm(DivineNameKind Kind, int PrefixLength, int StemLength);

    /// <summary>
    /// Every letter sequence that can be a divine name (~2,178 forms), built
    /// once: the matchable set is closed — prefix × stem × suffix combinations
    /// are enumerable — so matching is one hash lookup instead of rescanning
    /// ~57 clitic prefixes per name family for every word. Registration order
    /// mirrors the previous nested loops (יהוה, אלהים longest-stem-first, אל,
    /// שדי); TryAdd keeps that precedence, though each letter form decomposes
    /// uniquely anyway.
    /// </summary>
    private static readonly Dictionary<string, NameForm> Forms = BuildForms();

    /// <summary>Zero-allocation span lookup over <see cref="Forms"/> for the per-word hot path.</summary>
    private static readonly Dictionary<string, NameForm>.AlternateLookup<ReadOnlySpan<char>> FormsLookup =
        Forms.GetAlternateLookup<ReadOnlySpan<char>>();

    private static Dictionary<string, NameForm> BuildForms()
    {
        var forms = new Dictionary<string, NameForm>(2300);
        foreach (var prefix in CliticPrefixes(forEl: false))
        {
            forms.TryAdd(prefix + "יהוה", new NameForm(DivineNameKind.Yhwh, prefix.Length, 4));
        }
        foreach (var prefix in CliticPrefixes(forEl: false))
        {
            // Longest stems first so אלהים parses as אלהי+ם, never אלה+ים.
            foreach (var stem in ElohimStemSuffixes.Keys.OrderByDescending(s => s.Length))
            {
                foreach (var suffix in ElohimStemSuffixes[stem])
                {
                    forms.TryAdd(prefix + stem + suffix,
                        new NameForm(DivineNameKind.Elohim, prefix.Length, stem.Length));
                }
            }
        }
        foreach (var prefix in CliticPrefixes(forEl: true))
        {
            forms.TryAdd(prefix + "אל", new NameForm(DivineNameKind.El, prefix.Length, 2));
        }
        foreach (var prefix in CliticPrefixes(forEl: false))
        {
            forms.TryAdd(prefix + "שדי", new NameForm(DivineNameKind.Shaddai, prefix.Length, 3));
        }
        return forms;
    }

    /// <summary>
    /// Splits trailing non-Hebrew punctuation (paseq/maqaf/sof pasuk/space) —
    /// re-appended untouched after a match.
    /// </summary>
    private static void SplitTail(ReadOnlySpan<char> value,
        out ReadOnlySpan<char> body, out ReadOnlySpan<char> tail)
    {
        var cut = value.Length;
        while (cut > 0 && !IsHebrewLetter(value[cut - 1]) && !IsMark(value[cut - 1]))
        {
            cut--;
        }
        body = value[..cut];
        tail = value[cut..];
    }

    /// <summary>
    /// Collects the base Hebrew letters of <paramref name="body"/> into
    /// <paramref name="dest"/>, skipping combining marks. Returns the letter
    /// count, <see cref="MaxFormLetters"/> + 1 when the word is too long to be a
    /// name, -1 when the body holds a leading mark or any non-letter, non-mark
    /// character (such words can never be a divine name), or -2 when it holds
    /// a presentation form (U+FB1D-FB4F) the caller must NFD-normalize
    /// first - corpus text never does, so the decompose step stays off
    /// the hot path.
    /// </summary>
    private static int ExtractLetters(ReadOnlySpan<char> body, Span<char> dest)
    {
        var count = 0;
        for (var i = 0; i < body.Length; i++)
        {
            var ch = body[i];
            if (IsHebrewLetter(ch))
            {
                if (count == dest.Length)
                {
                    return MaxFormLetters + 1;
                }
                dest[count++] = ch;
            }
            else if (IsMark(ch))
            {
                if (count == 0)
                {
                    return -1;
                }
            }
            else if (ch is >= '\uFB1D' and <= '\uFB4F')
            {
                return -2;
            }
            else
            {
                return -1;
            }
        }
        return count;
    }

    /// <summary>Combining marks attached to the letter at <paramref name="letterIndex"/>.</summary>
    private static string MarksAt(ReadOnlySpan<char> body, int letterIndex)
    {
        var letter = -1;
        for (var i = 0; i < body.Length; i++)
        {
            if (!IsHebrewLetter(body[i]))
            {
                continue;
            }
            letter++;
            if (letter != letterIndex)
            {
                continue;
            }
            var j = i + 1;
            while (j < body.Length && IsMark(body[j]))
            {
                j++;
            }
            return body[(i + 1)..j].ToString();
        }
        return "";
    }

    private static bool MatchesEl(ReadOnlySpan<char> body, int stemStart)
    {
        var aleph = MarksAt(body, stemStart);
        if (aleph.Contains(Tzeire))
        {
            return true;
        }
        // Unpointed אל is treated as the name; any other vowel point
        // (אֶל/אַל/אֲל) is a different word.
        return !aleph.Any(IsNiqqud);
    }

    private static bool MatchesShaddai(ReadOnlySpan<char> body, int stemStart)
    {
        var shin = MarksAt(body, stemStart);
        var dalet = MarksAt(body, stemStart + 1);
        var yod = MarksAt(body, stemStart + 2);
        if (shin.Contains(SinDot))
        {
            return false;
        }
        if (dalet.Contains(Dagesh))
        {
            return true;
        }
        // Unpointed שדי is masked; a pointed שדי whose ד lacks dagesh
        // (שָׂדַי/שָׁדַי "my field") is not.
        return !(shin + dalet + yod).Any(IsNiqqud);
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

    /// <summary>
    /// Returns the masked form of a single word, or null when it is not a
    /// masked divine name under <paramref name="settings"/>. SplitTail strips
    /// trailing punctuation first; the match itself is one hash lookup over
    /// the closed letter-form table, with mark checks (tzeire for אל, sin dot
    /// /dagesh for שדי) applied only on the rare gated hits.
    /// </summary>
    private static string? MaskWord(ReadOnlySpan<char> value, DivineNameMaskingOptions settings)
    {
        SplitTail(value, out var body, out var tail);
        if (body.IsEmpty)
        {
            return null;
        }
        Span<char> letters = stackalloc char[MaxFormLetters];
        var count = ExtractLetters(body, letters);
        if (count == -2)
        {
            // Rare presentation forms — normalize once, then re-extract so the
            // letters and later mark checks see the decomposed text.
            var normalized = body.ToString().Normalize(NormalizationForm.FormD);
            body = normalized.AsSpan();
            count = ExtractLetters(body, letters);
        }
        if (count is < 1 or > MaxFormLetters)
        {
            return null;
        }
        if (!FormsLookup.TryGetValue(letters[..count], out var form))
        {
            return null;
        }
        var gated = form.Kind switch
        {
            DivineNameKind.El => MatchesEl(body, form.PrefixLength),
            DivineNameKind.Shaddai => MatchesShaddai(body, form.PrefixLength),
            _ => true,
        };
        if (!gated)
        {
            return null;
        }
        var stem = MaskStem(form.Kind,
            letters.Slice(form.PrefixLength, form.StemLength).ToString(), settings);
        return stem is null
            ? null
            : string.Concat(
                letters[..form.PrefixLength].ToString(),
                stem,
                letters[(form.PrefixLength + form.StemLength)..count].ToString(),
                tail.ToString());
    }

    /// <summary>אלוהים→אלקים convention: first ה→ק; a stem-final ה is restored after it.</summary>
    private static string ElokimStem(string stem)
    {
        var heh = stem.IndexOf('ה');
        var replaced = $"{stem[..heh]}ק{stem[(heh + 1)..]}";
        return heh == stem.Length - 1 ? $"{replaced}ה" : replaced;
    }

    private static string? MaskStem(DivineNameKind kind, string stem, DivineNameMaskingOptions settings) =>
        kind switch
        {
            DivineNameKind.Yhwh => settings.Yhwh switch
            {
                DivineNameMaskOption.Heh => "ה'",
                DivineNameMaskOption.Dalet => "ד'",
                _ => settings.YhwhCustom.Trim() is { Length: > 0 } custom ? custom : null,
            },
            DivineNameKind.Elohim => settings.Elohim switch
            {
                DivineNameMaskOption.AsIs => null,
                DivineNameMaskOption.Elokim => ElokimStem(stem),
                DivineNameMaskOption.Hyphen => $"{stem[0]}-{stem[1..]}",
                _ => settings.ElohimCustom.Trim() is { Length: > 0 } custom ? custom : null,
            },
            DivineNameKind.El => settings.El == DivineNameMaskOption.Hyphen ? "א-ל" : null,
            DivineNameKind.Shaddai => settings.Shaddai switch
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
        if (!options.Enabled || string.IsNullOrEmpty(value))
        {
            return value ?? "";
        }
        return MaskWord(value.AsSpan(), options) ?? value;
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
        if (!options.Enabled || string.IsNullOrEmpty(text))
        {
            return text ?? "";
        }
        var span = text.AsSpan();
        var builder = new StringBuilder(text.Length);
        var start = 0;
        for (var i = 0; i <= span.Length; i++)
        {
            if (i < span.Length && span[i] is not ' ' and not Maqaf)
            {
                continue;
            }
            if (i > start)
            {
                var piece = span[start..i];
                builder.Append(MaskWord(piece, options) is { } masked ? masked : piece);
            }
            if (i < span.Length)
            {
                builder.Append(span[i]);
            }
            start = i + 1;
        }
        return builder.ToString();
    }
}
