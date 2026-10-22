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
    Perek,

    /// <summary>
    /// Search within article content through the API's semantic index.
    /// Requires network access — performed remotely, unlike the local filters.
    /// </summary>
    Articles,

    /// <summary>
    /// Search within Tanahpedia encyclopedia entries (titles, canonical and
    /// alias names, and body text) through the GraphQL API — the same
    /// provider the website's /search uses. Requires network access.
    /// </summary>
    Tanahpedia
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
            SearchFilter.Articles => "תוכן מאמרים",
            SearchFilter.Tanahpedia => "תנכפדיה",
            _ => filter.ToString()
        };
    }

    /// <summary>
    /// Whether this kind is served remotely and therefore needs connectivity to
    /// produce results. Availability, not selection, decides whether a remote
    /// kind can run: remote kinds are selected by default like every other
    /// kind and are only skipped while actually offline (#2454).
    /// </summary>
    public static bool RequiresNetwork(this SearchFilter filter) =>
        filter is SearchFilter.Articles or SearchFilter.Tanahpedia;
}

/// <summary>
/// Availability rules for a search kind: remote kinds need connectivity and
/// תוכן פירוש needs the installed commentary pack. The filter sheet shows the
/// reason on the disabled row; effective searches skip unavailable kinds.
/// </summary>
public static class SearchKindAvailability
{
    /// <summary>Supporting text shown on a disabled remote-kind row while offline.</summary>
    public static string NetworkReason => "חיבור רשת נדרש";

    /// <summary>Supporting text shown on the תוכן פירוש row without the commentary pack.</summary>
    public static string CommentaryPackReason => "נדרשת חבילת פירושים";

    /// <summary>Why the kind cannot serve searches under these conditions, or null when it can.</summary>
    public static string? UnavailableReason(this SearchFilter filter, bool isOnline, bool commentaryPackAvailable) =>
        filter switch
        {
            SearchFilter.Perush when !commentaryPackAvailable => CommentaryPackReason,
            _ when filter.RequiresNetwork() && !isOnline => NetworkReason,
            _ => null
        };

    /// <summary>Whether the kind can serve a search under these conditions.</summary>
    public static bool IsAvailable(this SearchFilter filter, bool isOnline, bool commentaryPackAvailable) =>
        filter.UnavailableReason(isOnline, commentaryPackAvailable) == null;
}
