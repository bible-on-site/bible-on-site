using System.Globalization;
using System.Text;
using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Location of a search match expressed in normalized-text coordinates — the
/// space produced by <see cref="SearchText.Normalize"/>. Normalized offsets are
/// stable across niqqud, taamim, HTML markup and quoting differences;
/// <see cref="SearchMatch.ToRawRange"/> projects them back onto rendered text
/// for highlighting or measuring.
/// </summary>
public readonly record struct SearchMatchSpan(int Start, int Length);

/// <summary>
/// Locates the exact occurrence a search result points at inside rendered
/// content. Search results carry plain-text fragments (<see cref="PerushSearchResult.NoteContent"/>,
/// <see cref="ArticleSearchResult.Excerpt"/>) whose positions in indexed
/// normalized text do not survive rendering — niqqud, markup, entities and
/// generated spacing all shift offsets. These helpers re-locate the match with
/// the same normalization the index applied, instead of assuming indexed
/// offsets equal rendered offsets.
/// </summary>
public static class SearchMatch
{
    /// <summary>
    /// Finds the best match for <paramref name="query"/> in
    /// <paramref name="content"/> (plain text or HTML). Returns the span in
    /// normalized-text coordinates, or null when nothing matches — mirroring
    /// <see cref="SearchText.Score"/>: a whole-word phrase first, then a bare
    /// substring, then the first word scoring against any query term.
    /// </summary>
    public static SearchMatchSpan? Locate(string content, string? query)
    {
        var normalized = SearchText.Normalize(SearchText.PlainText(content ?? string.Empty));
        return LocateInNormalized(normalized, SearchText.Normalize(query ?? string.Empty));
    }

    /// <summary>
    /// Finds the occurrence described by <paramref name="excerpt"/> — a verbatim
    /// slice of the indexed plain text — inside <paramref name="content"/>, then
    /// narrows to the query span within that window. When the query words occur
    /// several times in the document, the excerpt anchors the occurrence the
    /// result actually ranked rather than the first match. Falls back to a plain
    /// <see cref="Locate"/> when the excerpt no longer appears (content edited
    /// since indexing).
    /// </summary>
    public static SearchMatchSpan? LocateByExcerpt(string content, string? excerpt, string? query)
    {
        var normalized = SearchText.Normalize(SearchText.PlainText(content ?? string.Empty));
        return LocateByExcerptNormalized(normalized, excerpt, query);
    }

    /// <summary>
    /// Locates the hit inside a combined perush display whose contents are the
    /// note rows joined with a single space — exactly like
    /// <see cref="PerushNoteDisplay.DisplayContent"/>. Identity comes from
    /// <paramref name="matchedNotePlain"/>: the note row whose normalized text
    /// equals it owns the match, even when sibling notes contain the same query
    /// words. Returns a span in the joined normalized text, or null when no note
    /// carries the match.
    /// </summary>
    public static SearchMatchSpan? LocateInJoinedNotes(
        IReadOnlyList<string> noteContents, string? matchedNotePlain, string? query)
    {
        var plains = new string[noteContents.Count];
        var norms = new string[noteContents.Count];
        for (var i = 0; i < noteContents.Count; i++)
        {
            plains[i] = SearchText.PlainText(noteContents[i]);
            norms[i] = SearchText.Normalize(plains[i]);
        }
        var joinedNormalized = SearchText.Normalize(string.Join(" ", plains));
        var needle = SearchText.Normalize(query ?? string.Empty);
        var target = SearchText.Normalize(matchedNotePlain ?? string.Empty);
        if (target.Length > 0)
        {
            // Walk the joined text in note order so notes normalize to the same
            // slice they occupy in DisplayContent; identical duplicates resolve
            // to the first occurrence, which is where the row sits.
            var searchFrom = 0;
            for (var i = 0; i < norms.Length; i++)
            {
                if (norms[i].Length == 0)
                {
                    continue;
                }
                var position = joinedNormalized.IndexOf(norms[i], searchFrom, StringComparison.Ordinal);
                if (position < 0)
                {
                    continue;
                }
                if (norms[i] == target)
                {
                    var inner = LocateInNormalized(norms[i], needle);
                    return inner is { } span
                        ? new SearchMatchSpan(position + span.Start, span.Length)
                        : new SearchMatchSpan(position, 0);
                }
                searchFrom = position + norms[i].Length;
            }
        }
        // Fallback — no surviving note identity: the query picks the location.
        return LocateInNormalized(joinedNormalized, needle);
    }

    /// <summary>
    /// Picks the note display that owns the hit's match — restricted to the
    /// hit's perush when its id is known — together with the span inside that
    /// display's combined normalized text.
    /// </summary>
    public static (PerushNoteDisplay Display, SearchMatchSpan Span)? ResolvePerushTarget(
        PerushSearchResult hit, IReadOnlyList<PerushNoteDisplay> displays)
    {
        var candidates = displays;
        if (int.TryParse(hit.PerushId, NumberStyles.Integer, CultureInfo.InvariantCulture, out var perushId))
        {
            candidates = displays.Where(display => display.PerushId == perushId).ToList();
        }
        foreach (var display in candidates)
        {
            if (LocateInJoinedNotes(display.NoteContents, hit.NoteContent, hit.SearchPhrase) is { } span)
            {
                return (display, span);
            }
        }
        return null;
    }

    /// <summary>
    /// Resolves an article hit to the content segment owning its occurrence.
    /// Article pages split HTML around media elements into sibling
    /// <see cref="Controls.HtmlView"/> segments; the excerpt anchors a window in
    /// the segments' joined normalized text which is then mapped back to a
    /// segment-local span for that view's highlight and measurement.
    /// </summary>
    /// <returns>(segment index, span in that segment's normalized text), or null.</returns>
    public static (int Segment, SearchMatchSpan Span)? ResolveArticleTarget(
        IReadOnlyList<string> segmentContents, string? excerpt, string? query)
    {
        var norms = new string[segmentContents.Count];
        var plains = new string[segmentContents.Count];
        for (var i = 0; i < segmentContents.Count; i++)
        {
            plains[i] = SearchText.PlainText(segmentContents[i]);
            norms[i] = SearchText.Normalize(plains[i]);
        }
        var joinedNormalized = SearchText.Normalize(string.Join(" ", plains));
        if (LocateByExcerptNormalized(joinedNormalized, excerpt, query) is not { } global)
        {
            return null;
        }
        // Walk the joined text in segment order — Normalize() can collapse the
        // join-space next to empty or punctuation-only segments, so segment
        // positions are found, not computed.
        var searchFrom = 0;
        for (var i = 0; i < norms.Length; i++)
        {
            if (norms[i].Length == 0)
            {
                continue;
            }
            var position = joinedNormalized.IndexOf(norms[i], searchFrom, StringComparison.Ordinal);
            if (position < 0)
            {
                continue;
            }
            if (global.Start < position + norms[i].Length)
            {
                var local = Math.Max(0, global.Start - position);
                // A span bleeding past the segment edge is clipped — the next
                // segment is media or unrelated text, not a continuation.
                return (i, new SearchMatchSpan(local, Math.Min(global.Length, norms[i].Length - local)));
            }
            searchFrom = position + norms[i].Length;
        }
        return null;
    }

    /// <summary>
    /// Projects a normalized span onto <paramref name="rendered"/> raw text —
    /// the string a platform actually displays (attributed-string value,
    /// Html.FromHtml output). Every normalized letter/digit maps to the raw
    /// character that produced it, so combining marks, quotes and surrogate
    /// pairs never shift the result. Returns a raw (start, end) pair.
    /// </summary>
    public static (int Start, int End) ToRawRange(string rendered, SearchMatchSpan span)
    {
        var map = NormalizedMap(rendered);
        if (map.Count == 0)
        {
            return (0, 0);
        }
        var startIndex = Math.Clamp(span.Start, 0, map.Count - 1);
        var rawStart = map[startIndex];
        if (span.Length <= 0)
        {
            return (rawStart, rawStart);
        }
        var endIndex = Math.Clamp(span.Start + span.Length - 1, 0, map.Count - 1);
        var rawEnd = map[endIndex] + 1;
        // Pull trailing combining marks of the final letter into the range so a
        // highlight covers the whole rendered glyph.
        while (rawEnd < rendered.Length && IsCombiningMark(rendered[rawEnd]))
        {
            rawEnd++;
        }
        return (rawStart, rawEnd);
    }

    /// <summary>
    /// Maps every character of <see cref="SearchText.Normalize"/>'s output to
    /// the index in <paramref name="raw"/> that produced it — the normalized
    /// string is map.Count characters long. Per-unit FormD decomposition keeps
    /// combining marks attributed to their own raw position exactly like the
    /// whole-string pass in <see cref="SearchText.Normalize"/>.
    /// </summary>
    internal static List<int> NormalizedMap(string raw)
    {
        var map = new List<int>(raw.Length);
        var lastEmittedSpace = true; // same "empty builder" state as Normalize
        var i = 0;
        while (i < raw.Length)
        {
            // Decompose per code point, not per UTF-16 unit — a lone surrogate
            // half is not valid input to Normalize().
            var unitLength = char.IsSurrogatePair(raw, i) ? 2 : 1;
            foreach (var c in raw.Substring(i, unitLength).Normalize(NormalizationForm.FormD))
            {
                if (IsCombiningMark(c) || IsQuoteLike(c))
                {
                    continue;
                }
                if (char.IsLetterOrDigit(c))
                {
                    map.Add(i);
                    lastEmittedSpace = false;
                }
                else if (!lastEmittedSpace)
                {
                    map.Add(i);
                    lastEmittedSpace = true;
                }
            }
            i += unitLength;
        }
        // Normalize() trims: a trailing emitted space never reaches the output.
        // Track the emit state — inspecting the raw char misfires on units
        // like '¼' whose decomposition ends in a letter after an inner space.
        if (lastEmittedSpace && map.Count > 0)
        {
            map.RemoveAt(map.Count - 1);
        }
        return map;
    }

    private static SearchMatchSpan? LocateByExcerptNormalized(string normalized, string? excerpt, string? query)
    {
        var needle = SearchText.Normalize(query ?? string.Empty);
        var window = SearchText.Normalize(excerpt ?? string.Empty);
        if (window.Length > 0)
        {
            var position = normalized.IndexOf(window, StringComparison.Ordinal);
            if (position >= 0)
            {
                return LocateInNormalized(window, needle) is { } span
                    ? new SearchMatchSpan(position + span.Start, span.Length)
                    // The excerpt still anchors the passage even when the query
                    // terms fall outside it (semantic hits): a zero-length,
                    // position-only span scrolls to the window.
                    : new SearchMatchSpan(position, 0);
            }
        }
        return LocateInNormalized(normalized, needle);
    }

    private static SearchMatchSpan? LocateInNormalized(string normalized, string needle)
    {
        if (needle.Length == 0 || normalized.Length == 0)
        {
            return null;
        }
        // Whole-word phrase — the hit SearchText.Score ranks at 100.
        var phraseIndex = (" " + normalized + " ").IndexOf(" " + needle + " ", StringComparison.Ordinal);
        if (phraseIndex >= 0)
        {
            return new SearchMatchSpan(phraseIndex, needle.Length);
        }
        // Bare substring — prefix/fuzzy hits can land inside a longer word.
        var subIndex = normalized.IndexOf(needle, StringComparison.Ordinal);
        if (subIndex >= 0)
        {
            return new SearchMatchSpan(subIndex, needle.Length);
        }
        // Token fallback — earliest word scoring against any query term.
        var terms = needle.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var start = -1;
        for (var i = 0; i <= normalized.Length; i++)
        {
            var inWord = i < normalized.Length && normalized[i] != ' ';
            if (inWord && start < 0)
            {
                start = i;
            }
            if (inWord || start < 0)
            {
                continue;
            }
            var word = normalized[start..i];
            var score = 0;
            foreach (var term in terms)
            {
                score = Math.Max(score, SearchText.TokenScore(word, term));
            }
            if (score > 0)
            {
                return new SearchMatchSpan(start, word.Length);
            }
            start = -1;
        }
        return null;
    }

    private static bool IsCombiningMark(char c) =>
        CharUnicodeInfo.GetUnicodeCategory(c) is UnicodeCategory.NonSpacingMark
            or UnicodeCategory.SpacingCombiningMark;

    private static bool IsQuoteLike(char c) =>
        c is '\'' or '"' or '׳' or '״' or '‘' or '’' or '“' or '”';
}
