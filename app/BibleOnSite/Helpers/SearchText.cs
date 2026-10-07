using System.Globalization;
using System.Net;
using System.Text;
using HtmlAgilityPack;

namespace BibleOnSite.Helpers;

/// <summary>Shared Hebrew normalization and conservative offline spelling tolerance.</summary>
public static class SearchText
{
    public static string PlainText(string text)
    {
        var document = new HtmlDocument();
        document.LoadHtml(text);
        foreach (var node in document.DocumentNode.SelectNodes("//script|//style") ?? Enumerable.Empty<HtmlNode>())
            node.Remove();
        foreach (var node in (document.DocumentNode.SelectNodes("//br|//p|//div|//li|//tr|//h1|//h2|//h3") ?? Enumerable.Empty<HtmlNode>()).ToArray())
            node.ParentNode?.InsertAfter(document.CreateTextNode(" "), node);
        return HtmlEntity.DeEntitize(document.DocumentNode.InnerText);
    }

    public static string Normalize(string text)
    {
        var builder = new StringBuilder();
        foreach (var c in text.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) is UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark)
                continue;
            if (c is '\'' or '"' or '\u05f3' or '\u05f4' or '\u2018' or '\u2019' or '\u201c' or '\u201d')
                continue;
            if (char.IsLetterOrDigit(c))
                builder.Append(char.ToLowerInvariant(c));
            else if (builder.Length > 0 && builder[^1] != ' ')
                builder.Append(' ');
        }
        return builder.ToString().Trim();
    }

    public static string[] Tokens(string text) => Normalize(text).Split(' ', StringSplitOptions.RemoveEmptyEntries);

    public static int Score(string text, string query)
    {
        var normalized = Normalize(text);
        var phrase = Normalize(query);
        if (phrase.Length == 0) return 0;
        if (normalized == phrase) return 110;
        if ((" " + normalized + " ").Contains(" " + phrase + " ", StringComparison.Ordinal)) return 100;
        var words = normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var scores = Tokens(phrase).Select(term => words.Select(word => TokenScore(word, term)).DefaultIfEmpty().Max()).ToArray();
        return scores.All(score => score > 0) ? scores.Min() : 0;
    }

    private static int TokenScore(string word, string term)
    {
        if (word == term) return 90;
        if (word.StartsWith(term, StringComparison.Ordinal)) return 80;
        var edits = MaxEdits(term);
        return edits > 0 && Distance(word, term, edits) <= edits ? 60 : 0;
    }

    public static int MaxEdits(string word) => word.Length < 4 ? 0 : word.Length < 8 ? 1 : 2;

    public static int Distance(string left, string right, int limit)
    {
        if (Math.Abs(left.Length - right.Length) > limit) return limit + 1;
        var previous = Enumerable.Range(0, right.Length + 1).ToArray();
        var current = new int[right.Length + 1];
        for (var i = 1; i <= left.Length; i++)
        {
            current[0] = i;
            for (var j = 1; j <= right.Length; j++)
                current[j] = Math.Min(Math.Min(current[j - 1] + 1, previous[j] + 1), previous[j - 1] + (left[i - 1] == right[j - 1] ? 0 : 1));
            if (current.Min() > limit) return limit + 1;
            (previous, current) = (current, previous);
        }
        return previous[right.Length];
    }

    /// <summary>Highlight normalized and fuzzy matches while retaining original vowels and safe HTML.</summary>
    public static string Snippet(string text, string query)
    {
        var plain = PlainText(text);
        var matches = new List<(int Start, int End)>();
        var terms = Tokens(query);
        if (!string.IsNullOrEmpty(query))
        {
            for (var offset = 0; offset < plain.Length;)
            {
                var position = plain.IndexOf(query, offset, StringComparison.OrdinalIgnoreCase);
                if (position < 0) break;
                matches.Add((position, position + query.Length));
                offset = position + query.Length;
            }
        }
        var wordStart = -1;
        for (var i = 0; i <= plain.Length; i++)
        {
            var inWord = i < plain.Length && (char.IsLetterOrDigit(plain[i]) ||
                CharUnicodeInfo.GetUnicodeCategory(plain[i]) == UnicodeCategory.NonSpacingMark ||
                plain[i] is '\'' or '"' or '\u05f3' or '\u05f4');
            if (inWord && wordStart < 0) wordStart = i;
            if (inWord || wordStart < 0) continue;
            var word = Normalize(plain[wordStart..i]);
            if (!matches.Any(match => match.Start < i && match.End > wordStart) && terms.Any(term => TokenScore(word, term) > 0))
                matches.Add((wordStart, i));
            wordStart = -1;
        }
        matches.Sort((left, right) => left.Start.CompareTo(right.Start));
        var start = matches.Count > 0 ? Math.Max(0, matches[0].Start - 20) : 0;
        var end = matches.Count > 0 ? Math.Min(plain.Length, matches[0].End + 20) : Math.Min(plain.Length, 50);
        var result = new StringBuilder(start > 0 ? "..." : "");
        var cursor = start;
        foreach (var match in matches.Where(match => match.Start >= start && match.End <= end))
        {
            result.Append(WebUtility.HtmlEncode(plain[cursor..match.Start]));
            result.Append("<b>").Append(WebUtility.HtmlEncode(plain[match.Start..match.End])).Append("</b>");
            cursor = match.End;
        }
        result.Append(WebUtility.HtmlEncode(plain[cursor..end]));
        if (end < plain.Length) result.Append("...");
        return result.ToString();
    }
}
