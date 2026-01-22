namespace BibleOnSite.Models;

/// <summary>
/// Represents the type of search filter for Bible search.
/// </summary>
public enum SearchFilter
{
    /// <summary>Search for authors/rabbis.</summary>
    Author,

    /// <summary>Search within pasuk text content.</summary>
    Pasuk,

    /// <summary>Search within perush/commentary content.</summary>
    Perush,

    /// <summary>Search for perek by name/source.</summary>
    Perek
}

/// <summary>
/// Gets the Hebrew display name for a search filter.
/// </summary>
public static class SearchFilterExtensions
{
    public static string GetHebrewName(this SearchFilter filter)
    {
        return filter switch
        {
            SearchFilter.Author => "רב",
            SearchFilter.Pasuk => "תוכן פסוק",
            SearchFilter.Perush => "תוכן פירוש",
            SearchFilter.Perek => "פרק",
            _ => filter.ToString()
        };
    }
}
