namespace BibleOnSite.Helpers;

/// <summary>
/// Parses Android app links (website URLs) and carries the requested target to
/// the reader page. The platform activity records links before the app shell
/// exists; PerekPage consumes the pending target during its initial load, or
/// the raised event drives navigation when the app is already running.
/// </summary>
public static class AppLinkHelper
{
    /// <summary>Website path prefix for perek/article pages is /929/.</summary>
    private const string PerekSection = "929";

    /// <summary>A website link target: a perek, optionally with an article.</summary>
    public readonly record struct AppLinkTarget(int PerekId, int? ArticleId);

    /// <summary>
    /// Link target that arrived before the reader page loaded. Consumed
    /// (cleared) by <see cref="Pages.PerekPage"/>.
    /// </summary>
    public static AppLinkTarget? PendingTarget { get; set; }

    /// <summary>Raised when an app link arrives while the app is running.</summary>
    public static event EventHandler<AppLinkTarget>? TargetRequested;

    /// <summary>
    /// Parses a website URL such as https://xn--febl3a.co.il/929/123 or
    /// https://xn--febl3a.com/929/123/456 into its target. The second
    /// numeric segment is an article id on the website's article route.
    /// Host is not validated — Android already filters by intent-filter hosts.
    /// </summary>
    public static bool TryParse(string? url, out AppLinkTarget target)
    {
        target = default;
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
        if (!int.TryParse(segments[1], out var perekId) || perekId is < 1 or > 929)
        {
            return false;
        }

        int? articleId = null;
        if (segments.Length > 2 && int.TryParse(segments[2], out var article) && article > 0)
        {
            articleId = article;
        }

        target = new AppLinkTarget(perekId, articleId);
        return true;
    }

    /// <summary>Hosts the website is served from; in-content links to any
    /// other host are external.</summary>
    private static readonly string[] SiteHosts = ["xn--febl3a.co.il", "xn--febl3a.com"];

    /// <summary>Base for site-relative hrefs (e.g. <c>/929/125/337</c>).</summary>
    private static readonly Uri SiteBase = new("https://xn--febl3a.co.il");

    /// <summary>
    /// Resolves an href from database HTML content (articles) against the
    /// website: site-relative paths and absolute website URLs become an
    /// absolute website URI. Returns false for other hosts and non-web
    /// schemes, so callers open those in the browser.
    /// </summary>
    public static bool TryResolveSiteUrl(string? href, out Uri siteUrl)
    {
        siteUrl = SiteBase;
        if (string.IsNullOrWhiteSpace(href))
        {
            return false;
        }
        var trimmed = href.Trim();
        // Checked before absolute parsing: Unix runtimes read "/929/1" as a file URI.
        if (trimmed.StartsWith('/') && !trimmed.StartsWith("//", StringComparison.Ordinal))
        {
            return Uri.TryCreate(SiteBase, trimmed, out siteUrl!);
        }
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
        {
            return false;
        }
        var host = uri.IdnHost.StartsWith("www.", StringComparison.OrdinalIgnoreCase)
            ? uri.IdnHost[4..]
            : uri.IdnHost;
        if (!SiteHosts.Contains(host, StringComparer.OrdinalIgnoreCase))
        {
            return false;
        }
        siteUrl = uri;
        return true;
    }

    /// <summary>
    /// Follows a link tapped in article HTML (#1227): <c>/929/...</c> perek and
    /// article links navigate natively through <see cref="Request"/>; other
    /// website pages and external links open via <paramref name="openInBrowser"/>.
    /// Fragment-only and other unresolvable hrefs are ignored.
    /// </summary>
    public static async Task FollowContentLinkAsync(string? href, Func<Uri, Task> openInBrowser)
    {
        if (TryResolveSiteUrl(href, out var siteUrl))
        {
            if (TryParse(siteUrl.AbsoluteUri, out var target))
            {
                Request(target);
                return;
            }
            await openInBrowser(siteUrl);
            return;
        }
        if (Uri.TryCreate(href?.Trim(), UriKind.Absolute, out var uri) && !uri.IsFile)
        {
            await openInBrowser(uri);
        }
    }

    /// <summary>Stores the requested target and notifies any running reader.</summary>
    public static void Request(AppLinkTarget target)
    {
        PendingTarget = target;
        TargetRequested?.Invoke(null, target);
    }
}
