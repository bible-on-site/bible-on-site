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
    public int GenerationOrder { get; set; } = int.MaxValue;
    public int SourceOrder => this switch
    {
        PerekSearchResult perek => perek.Perek.PerekId * 1000,
        PasukSearchResult pasuk => pasuk.PerekId * 1000 + pasuk.Pasuk.PasukNum,
        PerushSearchResult perush => perush.PerekId * 1000 + perush.PasukNum,
        _ => int.MaxValue
    };
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
/// Search result for a remote semantic article-content match.
/// Title carries the article name; SubtitleHtml the API's safe excerpt;
/// Source the formatted perek label (e.g. "בראשית א").
/// </summary>
public class ArticleSearchResult : SearchResult
{
    public int ArticleId { get; }
    public int PerekId { get; }
    public string AuthorName { get; }
    public string Source { get; }
    public string Excerpt { get; }

    public override SearchFilter ResultType => SearchFilter.Articles;

    public ArticleSearchResult(int articleId, int perekId, string authorName, string source, string excerpt, string searchPhrase)
    {
        ArticleId = articleId;
        PerekId = perekId;
        AuthorName = authorName;
        Source = source;
        Excerpt = excerpt;
        SearchPhrase = searchPhrase;
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
