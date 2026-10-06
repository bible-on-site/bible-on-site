namespace BibleOnSite.Helpers;

/// <summary>
/// Parses Android app links (website URLs) and carries the requested perek to
/// the reader page. The platform activity records links before the app shell
/// exists; PerekPage consumes the pending id during its initial load, or the
/// raised event drives navigation when the app is already running.
/// </summary>
public static class AppLinkHelper
{
    /// <summary>Website path for a perek is /929/{perekId}.</summary>
    private const string PerekSection = "929";

    /// <summary>
    /// Perek requested by an app link that arrived before the reader page
    /// loaded. Consumed (cleared) by <see cref="Pages.PerekPage"/>.
    /// </summary>
    public static int? PendingPerekId { get; set; }

    /// <summary>Raised when an app link arrives while the app is running.</summary>
    public static event EventHandler<int>? PerekRequested;

    /// <summary>
    /// Parses a website perek URL such as https://www.929.org.il/929/123 or
    /// https://xn--febl3a.co.il/929/123/slug into its perek id (1-929).
    /// Host is not validated — Android already filters by intent-filter host.
    /// </summary>
    public static bool TryParsePerekId(string? url, out int perekId)
    {
        perekId = 0;
        if (string.IsNullOrWhiteSpace(url) ||
            !Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            return false;
        }

        var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length < 2 || segments[0] != PerekSection)
        {
            return false;
        }
        if (!int.TryParse(segments[1], out var parsed) || parsed is < 1 or > 929)
        {
            return false;
        }

        perekId = parsed;
        return true;
    }

    /// <summary>Stores the requested perek and notifies any running reader.</summary>
    public static void RequestPerek(int perekId)
    {
        PendingPerekId = perekId;
        PerekRequested?.Invoke(null, perekId);
    }
}
