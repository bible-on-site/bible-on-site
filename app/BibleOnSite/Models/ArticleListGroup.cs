namespace BibleOnSite.Models;

/// <summary>
/// A titled article group for the reader's grouped articles view (#3752):
/// the perek's own list plus the לקריאה נוספת recommendations below it.
/// CollectionView grouping enumerates the group itself for items.
/// </summary>
public class ArticleListGroup(string title, IEnumerable<Article> items) : List<Article>(items)
{
    /// <summary>Section header text; empty renders no visible header.</summary>
    public string Title { get; } = title;

    /// <summary>
    /// Groups a perek reader's articles strip into its own list and the
    /// לקריאה נוספת recommendations (#3752). Only non-empty groups appear —
    /// a perek with no articles of its own still shows its recommendations,
    /// and a perek with no recommendations keeps the flat untitled look.
    /// </summary>
    public static List<ArticleListGroup> Build(
        List<Article> articles,
        List<Article> furtherArticles)
    {
        var groups = new List<ArticleListGroup>(2);
        if (articles.Count > 0)
        {
            groups.Add(new ArticleListGroup(string.Empty, articles));
        }
        if (furtherArticles.Count > 0)
        {
            groups.Add(new ArticleListGroup("לקריאה נוספת", furtherArticles));
        }
        return groups;
    }
}
