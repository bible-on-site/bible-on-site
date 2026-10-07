namespace BibleOnSite.Models;

/// <summary>
/// Base class for search results.
/// </summary>
public abstract class SearchResult
{
    public string SearchPhrase { get; set; } = string.Empty;
    public abstract SearchFilter ResultType { get; }
    public string Title { get; set; } = string.Empty;
    public string SubtitleHtml { get; set; } = string.Empty;
    public string Category => ResultType.GetHebrewName();
    public int Score { get; set; }
    public virtual string? ThumbnailUrl => null;
    public bool HasThumbnail => ThumbnailUrl != null;

    protected static string CreateHighlightedResult(string text, string searchPhrase)
    {
        return Helpers.SearchText.Snippet(text, searchPhrase ?? string.Empty);
    }
}

/// <summary>
/// Search result for an author match.
/// </summary>
public class AuthorSearchResult : SearchResult
{
    public Author Author { get; }
    public override string? ThumbnailUrl => Author.ImageUrl;

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
}
