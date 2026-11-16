using Microsoft.Maui.Controls;

namespace BibleOnSite.Services;

/// <summary>
/// One logical GA screen_view: a deterministic, readable screen_name (a
/// legacy-stable {kind}/{id} prefix plus a public content label), the stable
/// page-family screen_class reports drill down by, and public
/// content-identity parameters (#3378). screen_class always names the page
/// family; content scope lives in screen_name and the parameters — never
/// the other way around.
/// </summary>
public sealed record AnalyticsScreen(
    string Name,
    string Class,
    IReadOnlyDictionary<string, object>? Parameters = null);

/// <summary>
/// The browsing scope an articles catalogue or in-reader articles panel
/// reports — a list visit is never an article row (#3378).
/// </summary>
public enum ArticlesListScope { All, Perek, Author, Parasha, Masora, Moed }

/// <summary>
/// Logical GA screen naming (#2119) plus content-aware descriptors (#3378).
/// Firebase's automatic screen tracking is disabled in both platform
/// manifests because it only ever saw the host container — MainActivity on
/// Android, MAUI Shell renderer classes (ShellSectionRootRenderer,
/// ShellFlyoutRenderer) on iOS — never logical pages. Shell navigation
/// instead reports the page's descriptor through this mapper, and
/// self-reporting pages keep full ownership of their events.
/// </summary>
internal static class AnalyticsScreens
{
    /// <summary>
    /// GA4 caps event-parameter values (screen_name included) at 100
    /// characters and silently truncates beyond it. Clamp eagerly so a long
    /// Hebrew label lands identically on Android and iOS — the {kind}/{id}
    /// prefix preserves the stable key when the tail is cut.
    /// </summary>
    internal const int MaxValueLength = 100;

    /// <summary>
    /// The manual screen_view descriptor for a Shell-presented page, or null
    /// when the page must not produce a Shell-level event — either because it
    /// reports its own screen through <see cref="IAnalyticsScreenName"/>
    /// (the readers emit their unit-scoped events from lifecycle and carousel
    /// swipes, which a Shell event would double-count) or because it is a
    /// transient container that is not a user-facing screen (LoadingPage).
    /// </summary>
    internal static AnalyticsScreen? ScreenFor(Page? page) => page switch
    {
        null => null,
        IAnalyticsScreenName named => named.AnalyticsScreen,
        _ => new AnalyticsScreen(page.GetType().Name, page.GetType().Name),
    };

    /// <summary>
    /// Emits a resolved descriptor's single screen_view through the app's
    /// analytics service — the one lookup self-reporting pages share.
    /// </summary>
    internal static void Report(AnalyticsScreen screen)
    {
        var analytics = Application.Current?.Handler?.MauiContext?.Services.GetService<IAnalyticsService>();
        analytics?.SetScreen(screen.Name, screen.Class, screen.Parameters);
    }

    // — Reading units ————————————————————————————————————————————————————

    /// על הפרק reader: keeps the legacy AlHaperek/{id} prefix, now with the
    /// canonical Hebrew source ("בראשית א") so report rows identify the perek.
    internal static AnalyticsScreen ForPerek(int perekId, string? perekSource) =>
        Content($"AlHaperek/{perekId}", perekSource, "PerekPage",
            Params(("perek_id", perekId), ("perek_source", perekSource)));

    /// פרשה על הפרק reader: the stable parasha unit id plus its public title.
    internal static AnalyticsScreen ForParasha(int unitId, string? parashaName) =>
        Content($"ParashaAlHaperek/{unitId}", parashaName, "ParashaPage",
            Params(("parasha_id", unitId), ("parasha_name", parashaName)));

    /// מסורה על הפרק reader: the stable masora unit id plus its heading.
    internal static AnalyticsScreen ForMasora(int unitId, string? unitName) =>
        Content($"Masora/{unitId}", unitName, "MasoraPage",
            Params(("masora_unit_id", unitId), ("masora_unit_name", unitName)));

    /// מועדים על הפרק reader: the stable moed id plus its public name.
    internal static AnalyticsScreen ForMoed(int moedId, string? moedName) =>
        Content($"Moed/{moedId}", moedName, "MoedPage",
            Params(("moed_id", moedId), ("moed_name", moedName)));

    /// <summary>
    /// Article detail: the public article title and stable id, plus the
    /// perek context the article belongs to when known (#3378).
    /// </summary>
    internal static AnalyticsScreen ForArticle(int articleId, string? articleTitle,
        int? perekId, string? perekSource) =>
        Content($"Article/{articleId}", articleTitle, "ArticleDetailPage",
            Params(("article_id", articleId), ("article_title", articleTitle),
                ("perek_id", perekId is > 0 ? perekId.Value : null), ("perek_source", perekSource)));

    /// <summary>
    /// Articles catalogue/list descriptor. The page family stays fixed —
    /// "ArticlesPage" for the standalone catalogue, "ReaderArticles" for the
    /// in-reader panel — while list_scope plus the scope's own id/label
    /// parameters name the browsing context: a perek-scoped list, an author
    /// feed, a division-scoped panel, or an explicitly global catalogue.
    /// </summary>
    internal static AnalyticsScreen ForArticlesList(string screenClass,
        ArticlesListScope scope, int scopeId, string? scopeLabel)
    {
        var scopeName = ScopeName(scope);
        var parameters = new Dictionary<string, object> { ["list_scope"] = scopeName };
        if (ScopeParams(scope) is { } sp && scopeId > 0)
        {
            parameters[sp.IdParam] = scopeId;
            if (!string.IsNullOrWhiteSpace(scopeLabel))
            {
                parameters[sp.LabelParam] = Clamp(scopeLabel);
            }
        }
        var name = scope is ArticlesListScope.All || scopeId <= 0
            ? $"Articles/{scopeName}"
            : ContentName($"Articles/{scopeName}/{scopeId}", scopeLabel);
        return new AnalyticsScreen(Clamp(name), screenClass, parameters);
    }

    // — Internals ————————————————————————————————————————————————————————

    private static AnalyticsScreen Content(string idPrefix, string? label, string screenClass,
        IReadOnlyDictionary<string, object> parameters) =>
        new(Clamp(ContentName(idPrefix, label)), screenClass, parameters);

    /// <summary>"{idPrefix} {label}" when a readable label exists, else the bare prefix.</summary>
    private static string ContentName(string idPrefix, string? label) =>
        string.IsNullOrWhiteSpace(label) ? idPrefix : $"{idPrefix} {label}";

    private static string Clamp(string value) =>
        value.Length <= MaxValueLength ? value : value[..MaxValueLength];

    /// <summary>Drops unset entries; clamps strings to the GA4 value limit.</summary>
    private static IReadOnlyDictionary<string, object> Params(
        params (string Key, object? Value)[] entries)
    {
        var parameters = new Dictionary<string, object>();
        foreach (var (key, value) in entries)
        {
            if (value is null || value is string s && string.IsNullOrWhiteSpace(s))
            {
                continue;
            }
            parameters[key] = value is string text ? Clamp(text) : value;
        }
        return parameters;
    }

    private static string ScopeName(ArticlesListScope scope) => scope switch
    {
        ArticlesListScope.Perek => "perek",
        ArticlesListScope.Author => "author",
        ArticlesListScope.Parasha => "parasha",
        ArticlesListScope.Masora => "masora",
        ArticlesListScope.Moed => "moed",
        _ => "all",
    };

    /// <summary>The scope's own id/label parameter names — null for the
    /// global list, which has no scope entity to identify.</summary>
    private static (string IdParam, string LabelParam)? ScopeParams(ArticlesListScope scope) => scope switch
    {
        ArticlesListScope.Perek => ("perek_id", "perek_source"),
        ArticlesListScope.Author => ("author_id", "author_name"),
        ArticlesListScope.Parasha => ("parasha_id", "parasha_name"),
        ArticlesListScope.Masora => ("masora_unit_id", "masora_unit_name"),
        ArticlesListScope.Moed => ("moed_id", "moed_name"),
        _ => null,
    };
}

/// <summary>
/// A page that controls its own analytics screen identity. Implementations
/// return a logical screen descriptor (e.g. ArticlesPage → its perek/author
/// scope) or null to suppress the Shell-level screen_view — for pages that
/// emit their own screen_view through page lifecycle (the readers,
/// ArticleDetailPage) or that should never appear in reports (LoadingPage).
/// Public because XAML-generated page classes are public.
/// </summary>
public interface IAnalyticsScreenName
{
    AnalyticsScreen? AnalyticsScreen { get; }
}
