using System.Globalization;

namespace BibleOnSite.Helpers;

/// <summary>
/// Counts the readable blocks inside one rendered HTML fragment — the stored
/// <c>*_metric_block</c> rows the fragment covers (issue #2607). A direct
/// port of the shared counter's boundary rule
/// (<c>web/shared/reading-metrics/text.ts::htmlToReadableSegments</c>, twin
/// in Rust at <c>data/reading-metrics</c>): script/style blocks vanish,
/// every block-boundary tag (a block element's close, <c>br</c>/<c>hr</c>)
/// ends a segment, and only segments carrying at least one letter or digit
/// survive — the same filter that drops word-free block rows server-side.
/// Word counts stay with the stored metric rows; this only aligns their
/// boundaries with the rendered children so scroll progress can attribute
/// them — C# never re-tokenizes the content.
/// </summary>
public static class ReadableBlockCounter
{
    /// <summary>Block-level elements whose close tag ends a readable block —
    /// the same set the shared scanner uses. Inline formatting tags
    /// (b/i/span/a/sup/…) are not boundaries.</summary>
    private static readonly HashSet<string> BlockTags = new(StringComparer.Ordinal)
    {
        "address", "article", "aside", "blockquote", "dd", "details", "dialog",
        "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
        "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav",
        "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot",
        "th", "thead", "tr", "ul",
    };

    /// <summary>Void tags that break text on their own (no close tag needed).</summary>
    private static readonly HashSet<string> VoidBreakTags = new(StringComparer.Ordinal) { "br", "hr" };

    /// <summary>The entities that appear in stored content: the standard XML
    /// set, nbsp, and numeric (decimal/hex) references — mirrored from the
    /// shared decoder.</summary>
    private static readonly Dictionary<string, string> NamedEntities = new(StringComparer.Ordinal)
    {
        ["lt"] = "<",
        ["gt"] = ">",
        ["amp"] = "&",
        ["quot"] = "\"",
        ["apos"] = "'",
        ["nbsp"] = " ",
    };

    /// <summary>
    /// Number of word-bearing readable segments in <paramref name="html"/> —
    /// i.e. how many stored <c>*_metric_block</c> rows the fragment covers.
    /// </summary>
    public static int Count(string? html)
    {
        if (string.IsNullOrEmpty(html))
        {
            return 0;
        }
        return ReadableSegments(html).Count(HasWordChar);
    }

    /// <summary>
    /// Split stored HTML into readable-text segments exactly as the shared
    /// scanner does: entities decode inside each segment, scripts and styles
    /// never reach a segment, and every block-boundary tag ends the current
    /// segment.
    /// </summary>
    private static List<string> ReadableSegments(string html)
    {
        var cleaned = StripScriptsAndStyles(html);
        var segments = new List<string>();
        var current = new System.Text.StringBuilder();
        void Flush()
        {
            if (current.Length > 0)
            {
                segments.Add(current.ToString());
                current.Clear();
            }
        }

        var i = 0;
        while (i < cleaned.Length)
        {
            var c = cleaned[i];
            if (c != '<')
            {
                current.Append(c);
                i += 1;
                continue;
            }
            if (ParseTagAt(cleaned, i) is not { } tag)
            {
                // A literal '<' (not followed by a letter, '/', '!' or '?')
                // stays text.
                current.Append(c);
                i += 1;
                continue;
            }
            if (!tag.Terminated)
            {
                // '<tag' dangling at EOF stays literal text.
                current.Append(cleaned, i, cleaned.Length - i);
                break;
            }
            if ((tag.Closing && BlockTags.Contains(tag.Name)) ||
                VoidBreakTags.Contains(tag.Name))
            {
                Flush();
            }
            i = tag.End;
        }
        Flush();
        return segments.Select(DecodeEntities).ToList();
    }

    /// <summary>Remove every <c>&lt;script&gt;…&lt;/script&gt;</c> and
    /// <c>&lt;style&gt;…&lt;/style&gt;</c> block.</summary>
    private static string StripScriptsAndStyles(string text)
    {
        if (!text.Contains('<'))
        {
            return text;
        }
        var rest = text;
        var output = new System.Text.StringBuilder();
        while (FindScriptOrStyle(rest) is { } found)
        {
            output.Append(rest, 0, found.Start);
            rest = rest[found.AfterEnd..];
        }
        return output.Append(rest).ToString();
    }

    /// <summary>
    /// Locate the earliest <c>&lt;script&gt;</c>/<c>&lt;style&gt;</c> open tag.
    /// Returns <c>(start, afterEnd)</c> — the index just past the matching
    /// close tag, or just past the open tag when the close is missing.
    /// </summary>
    private static (int Start, int AfterEnd)? FindScriptOrStyle(string text)
    {
        var lower = text.ToLowerInvariant();
        (int Start, int AfterEnd)? best = null;
        foreach (var name in new[] { "script", "style" })
        {
            var open = $"<{name}";
            var search = 0;
            while (true)
            {
                var pos = lower.IndexOf(open, search, StringComparison.Ordinal);
                if (pos < 0)
                {
                    break;
                }
                if (best is { } b && pos >= b.Start)
                {
                    break;
                }
                var at = pos + open.Length;
                // The tag name must end at a non-identifier char or EOF, so
                // '<scriptx' never aliases a real script block.
                if (at >= lower.Length || !IsTagNameChar(lower[at]))
                {
                    // The shared scanners match the close by prefix rather
                    // than a complete close tag, so a spaced or suffixed
                    // close still ends the block; the step past it covers
                    // whichever char closed the tag.
                    var close = $"</{name}";
                    var closeAt = lower.IndexOf(close, at, StringComparison.Ordinal);
                    var after = closeAt < 0 ? at : closeAt + close.Length + 1;
                    best = (pos, Math.Min(after, text.Length));
                    break;
                }
                search = at;
            }
        }
        return best;
    }

    private readonly record struct TagMatch(int End, string Name, bool Closing, bool Terminated);

    /// <summary>
    /// Parse a tag starting at <c>text[start] === '&lt;'</c>. Returns null
    /// when the '&lt;' is literal text (not followed by a letter, '/', '!'
    /// or '?'). An unterminated tag consumes to EOF and reports
    /// <c>Terminated: false</c>.
    /// </summary>
    private static TagMatch? ParseTagAt(string text, int start)
    {
        var next = start + 1 < text.Length ? text[start + 1] : '\0';
        if (next == '\0' || !(IsAsciiLetter(next) || next is '/' or '!' or '?'))
        {
            return null;
        }
        var i = start + 1;
        var closing = false;
        if (text[i] == '/')
        {
            closing = true;
            i += 1;
        }
        var name = new System.Text.StringBuilder();
        while (i < text.Length && IsTagNameChar(text[i]))
        {
            name.Append(char.ToLowerInvariant(text[i]));
            i += 1;
        }
        var terminated = false;
        while (i < text.Length)
        {
            if (text[i] == '>')
            {
                terminated = true;
                i += 1;
                break;
            }
            i += 1;
        }
        return new TagMatch(i, name.ToString(), closing, terminated);
    }

    /// <summary>Decode the entities that appear in stored content; unknown
    /// or out-of-range references stay literal.</summary>
    private static string DecodeEntities(string text)
    {
        if (!text.Contains('&'))
        {
            return text;
        }
        var output = new System.Text.StringBuilder(text.Length);
        var i = 0;
        while (i < text.Length)
        {
            var amp = text.IndexOf('&', i);
            if (amp < 0)
            {
                output.Append(text, i, text.Length - i);
                break;
            }
            output.Append(text, i, amp - i);
            var semicolon = text.IndexOf(';', amp + 1);
            if (semicolon < 0)
            {
                output.Append(text, amp, text.Length - amp);
                break;
            }
            var body = text[(amp + 1)..semicolon];
            if (!IsEntityBody(body))
            {
                // Not the shared decoder's entity shape — the '&' is literal
                // text and scanning resumes after it, so a real entity that
                // starts inside this span still decodes.
                output.Append('&');
                i = amp + 1;
                continue;
            }
            var decoded = body.StartsWith('#')
                ? DecodeNumeric(
                    body.StartsWith("#x", StringComparison.Ordinal)
                        ? body[2..]
                        : body[1..],
                    body.Length > 1 && body[1] == 'x' ? 16 : 10)
                : NamedEntities.TryGetValue(body, out var named) ? named : null;
            if (decoded is null)
            {
                // Unknown entity — re-emit it literally, '&' through ';'.
                output.Append(text, amp, semicolon - amp + 1);
            }
            else
            {
                output.Append(decoded);
            }
            i = semicolon + 1;
        }
        return output.ToString();
    }

    /// <summary>The shared decoder's entity-body shape:
    /// <c>#x[0-9a-fA-F]+</c> (lowercase x only — the shared pattern rejects
    /// <c>#X</c>), <c>#\d+</c>, or <c>[a-zA-Z]+</c>.</summary>
    private static bool IsEntityBody(string body)
    {
        if (body.Length == 0)
        {
            return false;
        }
        if (body[0] != '#')
        {
            return body.All(IsAsciiLetter);
        }
        if (body.Length > 1 && body[1] == 'x')
        {
            return body.Length > 2 && body.Skip(2).All(IsHexDigit);
        }
        return body.Length > 1 && body.Skip(1).All(c => c is >= '0' and <= '9');
    }

    private static bool IsHexDigit(char c) =>
        c is >= '0' and <= '9' or >= 'a' and <= 'f' or >= 'A' and <= 'F';

    /// <summary>Decode a numeric character reference, or null when the code
    /// point is out of range or overflows — the scanner keeps the entity
    /// literal then. <c>TryParse</c> reports overflow as false, so a huge
    /// <c>&amp;#xFFFF…;</c> degrades instead of throwing.</summary>
    private static string? DecodeNumeric(string digits, int radix)
    {
        var style = radix == 16 ? NumberStyles.HexNumber : NumberStyles.Integer;
        if (!int.TryParse(digits, style, CultureInfo.InvariantCulture, out var codePoint))
        {
            return null;
        }
        return codePoint is >= 0 and <= 0x10FFFF
            ? char.ConvertFromUtf32(codePoint)
            : null;
    }

    /// <summary>A segment counts only when it carries at least one letter or
    /// digit (any script) — the shared counter's word-char class
    /// <c>[\p{L}\p{N}]</c>.</summary>
    private static bool HasWordChar(string text) =>
        text.Select(CharUnicodeInfo.GetUnicodeCategory).Any(IsWordCategory);

    /// <summary>Letter (any script) or number — <c>\p{L}</c> spans
    /// UppercaseLetter through OtherLetter, <c>\p{N}</c> DecimalDigitNumber
    /// through OtherNumber.</summary>
    private static bool IsWordCategory(UnicodeCategory category) =>
        category is >= UnicodeCategory.UppercaseLetter and <= UnicodeCategory.OtherLetter
            or >= UnicodeCategory.DecimalDigitNumber and <= UnicodeCategory.OtherNumber;

    /// <summary>ASCII letter — a char-code range beats a regex scan.</summary>
    private static bool IsAsciiLetter(char c) => c is >= 'a' and <= 'z' or >= 'A' and <= 'Z';

    /// <summary>Tag-name characters: ASCII letters and digits.</summary>
    private static bool IsTagNameChar(char c) => IsAsciiLetter(c) || c is >= '0' and <= '9';
}
