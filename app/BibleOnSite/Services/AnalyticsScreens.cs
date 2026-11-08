using Microsoft.Maui.Controls;

namespace BibleOnSite.Services;

/// <summary>
/// Logical GA screen naming (#2119). Firebase's automatic screen tracking is
/// disabled in both platform manifests because it only ever saw the host
/// container — MainActivity on Android, MAUI Shell renderer classes
/// (ShellSectionRootRenderer, ShellFlyoutRenderer) on iOS — never logical
/// pages. Shell navigation instead reports the page's logical name through
/// this mapper, and self-reporting pages keep full ownership of their events.
/// </summary>
internal static class AnalyticsScreens
{
    /// <summary>
    /// The manual screen_view name for a Shell-presented page, or null when
    /// the page must not produce a Shell-level event — either because it
    /// reports its own screen through <see cref="IAnalyticsScreenName"/>
    /// (the reader logs AlHaperek/{perekId} from its lifecycle and carousel
    /// swipes, which a Shell event would double-count) or because it is a
    /// transient container that is not a user-facing screen (LoadingPage).
    /// </summary>
    internal static string? ScreenNameFor(Page? page) => page switch
    {
        null => null,
        IAnalyticsScreenName named => named.AnalyticsScreenName,
        _ => page.GetType().Name,
    };
}

/// <summary>
/// A page that controls its own analytics screen identity. Implementations
/// return a logical screen name (e.g. ArticleDetailPage → "Article/{id}") or
/// null to suppress the Shell-level screen_view — for pages that emit their
/// own screen_view through page lifecycle (PerekPage) or that should never
/// appear in reports (LoadingPage). Public because XAML-generated page
/// classes are public.
/// </summary>
public interface IAnalyticsScreenName
{
    string? AnalyticsScreenName { get; }
}
