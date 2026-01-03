namespace BibleOnSite.Models;

/// <summary>
/// Represents a Sefer (book) in the Tanah.
/// </summary>
public class Sefer
{
    public int Id { get; set; }
    public required string Name { get; set; }

    /// <summary>
    /// The English transliteration name used in TanahUS.
    /// Can be a simple string or a dictionary for books with additionals (e.g., שמואל א, שמואל ב).
    /// </summary>
    public object? TanahUsName { get; set; }

    /// <summary>
    /// Gets the TanahUS name for a specific additional, or the simple name if no additionals exist.
    /// </summary>
    public string GetTanahUsName(int? additional = null)
    {
        if (TanahUsName is string simpleName)
        {
            return simpleName;
        }

        if (TanahUsName is Dictionary<int, string> additionalNames && additional.HasValue)
        {
            return additionalNames.TryGetValue(additional.Value, out var name) ? name : string.Empty;
        }

        return string.Empty;
    }
}
