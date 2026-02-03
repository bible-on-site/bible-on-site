namespace BibleOnSite.Models;

/// <summary>
/// Represents an author of articles/perushim.
/// </summary>
public class Author
{
    /// <summary>
    /// System author ID for system-generated content.
    /// </summary>
    public const int SystemId = 99;

    /// <summary>
    /// S3 bucket base URL for author images.
    /// </summary>
    private const string ImageBaseUrl = "https://bible-on-site-assets.s3.il-central-1.amazonaws.com/authors";

    public int Id { get; set; }
    public int ArticlesCount { get; set; }
    public required string Details { get; set; }
    public required string Name { get; set; }

    /// <summary>
    /// Gets a shortened version of the name (first two words).
    /// </summary>
    public string ShortenedName
    {
        get
        {
            if (string.IsNullOrEmpty(Name))
                return string.Empty;

            var parts = Name.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            return parts.Length >= 2
                ? $"{parts[0]} {parts[1]}"
                : Name;
        }
    }

    /// <summary>
    /// URL to the author's image (high resolution).
    /// </summary>
    public string ImageUrl => $"{ImageBaseUrl}/high-res/{Id}.jpg";
}
