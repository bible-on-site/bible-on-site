namespace BibleOnSite.Models;

/// <summary>
/// Represents an article/perush on a perek.
/// </summary>
public class Article
{
    public int Id { get; set; }
    public required string Abstract { get; set; }
    public string? ArticleContent { get; set; }
    public int AuthorId { get; set; }
    public int PerekId { get; set; }
    public int? Priority { get; set; }
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The author of this article (populated from API).
    /// </summary>
    public Author? Author { get; set; }

    /// <summary>
    /// Extracts plain text from the HTML abstract.
    /// </summary>
    public string ShortAbstract
    {
        get
        {
            if (string.IsNullOrEmpty(Abstract))
                return string.Empty;

            var text = Abstract;

            // Try to find H1 content
            var h1Start = text.IndexOf("<H1>", StringComparison.OrdinalIgnoreCase);
            var h1End = text.IndexOf("</H1>", StringComparison.OrdinalIgnoreCase);

            if (h1Start >= 0 && h1End > h1Start)
            {
                text = text.Substring(h1Start + 4, h1End - h1Start - 4);
            }

            // Remove remaining HTML tags
            text = System.Text.RegularExpressions.Regex.Replace(text, "<[^>]+>", string.Empty);

            return text.Trim();
        }
    }

    /// <summary>
    /// Creates a mock/placeholder article for loading states.
    /// </summary>
    public static Article CreateMock()
    {
        return new Article
        {
            Id = -1,
            Abstract = "בטעינה",
            ArticleContent = "טוען...",
            AuthorId = Author.SystemId,
            PerekId = -1,
            Priority = 1
        };
    }
}
