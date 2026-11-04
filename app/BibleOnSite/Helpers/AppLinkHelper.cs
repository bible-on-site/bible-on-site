using BibleOnSite.Services;
using Microsoft.Maui.ApplicationModel;

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

    /// <summary>
    /// A website link target: a perek, optionally with an article and/or a
    /// pasuk scroll anchor (<c>?pasuk=N</c> / <c>#pasuk-N</c>, #1227).
    /// </summary>
    public readonly record struct AppLinkTarget(int PerekId, int? ArticleId = null, int? PasukNumber = null);

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

        // A pasuk anchor only has meaning on perek and perush-slug routes:
        // the website's article route ignores ?pasuk (it scrolls to
        // article-view; only ?q marks an in-article landing), so an article
        // target drops the anchor instead of carrying a dead field.
        target = new AppLinkTarget(perekId, articleId,
            articleId is null ? ParsePasukNumber(uri) : null);
        return true;
    }

    /// <summary>
    /// The website marks scroll pesukim as <c>?pasuk=N</c> (perush-page note
    /// anchors) or <c>#pasuk-N</c> (perek-page pasuk anchors). Returns the
    /// 1-based pasuk number, or null when the link carries none.
    /// </summary>
    private static int? ParsePasukNumber(Uri uri)
    {
        foreach (var part in uri.Query.Split('?', '&'))
        {
            if (part.StartsWith("pasuk=", StringComparison.Ordinal) &&
                int.TryParse(part.AsSpan("pasuk=".Length), out var queryPasuk) && queryPasuk > 0)
            {
                return queryPasuk;
            }
        }
        const string anchorPrefix = "#pasuk-";
        return uri.Fragment.StartsWith(anchorPrefix, StringComparison.Ordinal) &&
            int.TryParse(uri.Fragment.AsSpan(anchorPrefix.Length), out var anchorPasuk) && anchorPasuk > 0
            ? anchorPasuk
            : null;
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

    /// <summary>How a link tapped in rendered HTML content resolves (#1227).</summary>
    public enum ContentLinkKind
    {
        /// <summary>/929/ perek, article and pasuk-anchored links — native reader navigation.</summary>
        Perek,
        /// <summary>/pedia/{slug} links — the Tanahpedia entry page.</summary>
        PediaEntry,
        /// <summary>Other website pages — open in the browser with the resolved site URL.</summary>
        SitePage,
        /// <summary>Off-site absolute URIs — open in the browser unchanged.</summary>
        External,
        /// <summary>Fragments, protocol-relative and malformed hrefs — the tap is ignored.</summary>
        Ignored,
    }

    /// <summary>A classified in-content link: the kind plus the payload it carries.</summary>
    /// <param name="Kind">Which target the link resolves to.</param>
    /// <param name="Target">The perek/article/pasuk target when <paramref name="Kind"/> is <see cref="ContentLinkKind.Perek"/>.</param>
    /// <param name="EntryUniqueName">The Tanahpedia entry slug when <paramref name="Kind"/> is <see cref="ContentLinkKind.PediaEntry"/>.</param>
    /// <param name="BrowserUri">The URI to open in the browser for the browser-served kinds.</param>
    public readonly record struct ContentLink(
        ContentLinkKind Kind, AppLinkTarget Target, string? EntryUniqueName, Uri? BrowserUri);

    /// <summary>
    /// Classifies an href tapped in rendered HTML content against the
    /// website's route grammar: <c>/929/{perekId}[/{articleId|perush}]</c>
    /// (with optional pasuk anchors), <c>/pedia/{slug}</c>, other site pages
    /// and external links (#1227).
    /// </summary>
    public static ContentLink ClassifyContentLink(string? href)
    {
        if (TryResolveSiteUrl(href, out var siteUrl))
        {
            if (TryParse(siteUrl.AbsoluteUri, out var target))
            {
                return new ContentLink(ContentLinkKind.Perek, target, null, null);
            }
            if (TanahpediaLinks.TryGetEntryUniqueName(siteUrl.AbsoluteUri, out var uniqueName))
            {
                return new ContentLink(ContentLinkKind.PediaEntry, default, uniqueName, siteUrl);
            }
            return new ContentLink(ContentLinkKind.SitePage, default, null, siteUrl);
        }
        if (Uri.TryCreate(href?.Trim(), UriKind.Absolute, out var uri) && !uri.IsFile)
        {
            return new ContentLink(ContentLinkKind.External, default, null, uri);
        }
        return new ContentLink(ContentLinkKind.Ignored, default, null, null);
    }

    /// <summary>
    /// <see cref="FollowContentLinkAsync(string?, Func{Uri, Task}, Func{string, Task}?)"/>
    /// without a Tanahpedia handler: <c>/pedia/</c> links open in the browser
    /// like other website pages.
    /// </summary>
    public static Task FollowContentLinkAsync(string? href, Func<Uri, Task> openInBrowser) =>
        FollowContentLinkAsync(href, openInBrowser, null);

    /// <summary>
    /// Follows a link tapped in rendered HTML content (#1227): <c>/929/...</c>
    /// perek, article and pasuk links navigate natively through
    /// <see cref="Request"/>; <c>/pedia/...</c> links navigate natively via
    /// <paramref name="openPediaEntry"/> when the caller supplies it (otherwise
    /// they open in the browser like other website pages); external links open
    /// via <paramref name="openInBrowser"/>. Fragment-only and other
    /// unresolvable hrefs are ignored.
    /// </summary>
    public static async Task FollowContentLinkAsync(string? href, Func<Uri, Task> openInBrowser,
        Func<string, Task>? openPediaEntry)
    {
        var link = ClassifyContentLink(href);
        switch (link.Kind)
        {
            case ContentLinkKind.Perek:
                Request(link.Target);
                return;
            case ContentLinkKind.PediaEntry when openPediaEntry != null:
                await openPediaEntry(link.EntryUniqueName!);
                return;
            case ContentLinkKind.PediaEntry:
            case ContentLinkKind.SitePage:
            case ContentLinkKind.External:
                await openInBrowser(link.BrowserUri!);
                return;
            case ContentLinkKind.Ignored:
            default:
                return;
        }
    }

    /// <summary>
    /// Follows an in-content link with the app's actors: <c>/929/</c> links
    /// ride the app-link channel into the reader, <c>/pedia/</c> links push the
    /// Tanahpedia entry page, and the rest open in the browser (#1227).
    /// </summary>
    public static Task FollowHtmlLinkAsync(string? href, ILauncher launcher, IAppNavigator navigator) =>
        FollowContentLinkAsync(href, launcher.OpenAsync,
            uniqueName => navigator.GoToAsync(AppRoutes.TanahpediaEntry(uniqueName)));

    /// <summary>Stores the requested target and notifies any running reader.</summary>
    public static void Request(AppLinkTarget target)
    {
        PendingTarget = target;
        TargetRequested?.Invoke(null, target);
    }
}
