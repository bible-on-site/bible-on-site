namespace BibleOnSite.Models;

/// <summary>
/// Base class for search results.
/// </summary>
public abstract class SearchResult
{
    public string SearchPhrase { get; set; } = string.Empty;
    public abstract SearchFilter ResultType { get; }
}

/// <summary>
/// Search result for an author match.
/// </summary>
public class AuthorSearchResult : SearchResult
{
    public Author Author { get; }

    public override SearchFilter ResultType => SearchFilter.Author;

    public AuthorSearchResult(Author author, string searchPhrase)
    {
        Author = author;
        SearchPhrase = searchPhrase;
    }
}

/// <summary>
/// Search result for a perek match.
/// </summary>
public class PerekSearchResult : SearchResult
{
    public Perek Perek { get; }

    public override SearchFilter ResultType => SearchFilter.Perek;

    public PerekSearchResult(Perek perek, string searchPhrase)
    {
        Perek = perek;
        SearchPhrase = searchPhrase;
    }
}

/// <summary>
/// Search result for a pasuk text match.
/// </summary>
public class PasukSearchResult : SearchResult
{
    public Pasuk Pasuk { get; }
    public int PerekId { get; }
    public string HighlightedResult { get; }

    public override SearchFilter ResultType => SearchFilter.Pasuk;

    public PasukSearchResult(Pasuk pasuk, int perekId, string searchPhrase)
    {
        Pasuk = pasuk;
        PerekId = perekId;
        SearchPhrase = searchPhrase;
        HighlightedResult = CreateHighlightedResult(pasuk.Text, searchPhrase);
    }

    private static string CreateHighlightedResult(string text, string searchPhrase)
    {
        if (string.IsNullOrEmpty(searchPhrase) || !text.Contains(searchPhrase))
            return text.Length > 50 ? text[..50] + "..." : text;

        var highlighted = text.Replace(searchPhrase, $"<b>{searchPhrase}</b>");
        var matchIndex = highlighted.IndexOf("<b>", StringComparison.Ordinal);

        if (matchIndex < 0)
            return highlighted.Length > 50 ? highlighted[..50] + "..." : highlighted;

        // Extract context around the match
        var start = Math.Max(0, matchIndex - 20);
        var end = Math.Min(highlighted.Length, matchIndex + searchPhrase.Length + 7 + 20); // +7 for <b></b>

        var result = highlighted[start..end];
        if (start > 0) result = "..." + result;
        if (end < highlighted.Length) result += "...";

        return result;
    }
}

/// <summary>
/// Search result for a perush/commentary match.
/// </summary>
public class PerushSearchResult : SearchResult
{
    public string PerushId { get; }
    public string NoteContent { get; }
    public int PerekId { get; }
    public int PasukNum { get; }
    public string HighlightedResult { get; }

    public override SearchFilter ResultType => SearchFilter.Perush;

    public PerushSearchResult(string perushId, string noteContent, int perekId, int pasukNum, string searchPhrase)
    {
        PerushId = perushId;
        NoteContent = noteContent;
        PerekId = perekId;
        PasukNum = pasukNum;
        SearchPhrase = searchPhrase;
        HighlightedResult = CreateHighlightedResult(noteContent, searchPhrase);
    }

    private static string CreateHighlightedResult(string text, string searchPhrase)
    {
        if (string.IsNullOrEmpty(searchPhrase) || !text.Contains(searchPhrase))
            return text.Length > 50 ? text[..50] + "..." : text;

        var highlighted = text.Replace(searchPhrase, $"<b>{searchPhrase}</b>");
        var matchIndex = highlighted.IndexOf("<b>", StringComparison.Ordinal);

        if (matchIndex < 0)
            return highlighted.Length > 50 ? highlighted[..50] + "..." : highlighted;

        var start = Math.Max(0, matchIndex - 20);
        var end = Math.Min(highlighted.Length, matchIndex + searchPhrase.Length + 7 + 20);

        var result = highlighted[start..end];
        if (start > 0) result = "..." + result;
        if (end < highlighted.Length) result += "...";

        return result;
    }
}
