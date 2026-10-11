using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Pages;

public partial class ArticleDetailPage
{
    private ArticleSearchResult? _searchJumpTarget;

    /// <summary>
    /// Receives the selected search result (phrase + ranked excerpt) so the
    /// page can scroll to the exact matching occurrence once content is built
    /// and laid out (#2078). Object-valued parameters only flow through
    /// IQueryAttributable.
    /// </summary>
    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (query.TryGetValue("searchResult", out var value) && value is ArticleSearchResult result)
        {
            _searchJumpTarget = result;
        }
    }

    /// <summary>
    /// Scrolls to the search result's exact occurrence: the excerpt anchors the
    /// matching window in the joined segment text, the resolved segment's
    /// HtmlView highlights the match, and the ScrollView lands it below the
    /// header once the native text layout reports a line position (#2078).
    /// </summary>
    private async Task ApplySearchJumpAsync()
    {
        var target = _searchJumpTarget;
        _searchJumpTarget = null;
        if (target == null)
        {
            return;
        }
        var htmlViews = ArticleContentContainer.Children.OfType<HtmlView>().ToList();
        if (htmlViews.Count == 0)
        {
            return;
        }
        var resolved = SearchMatch.ResolveArticleTarget(
            htmlViews.Select(view => view.HtmlContent ?? string.Empty).ToList(),
            target.Excerpt,
            target.SearchPhrase);
        if (resolved is not { } hit)
        {
            return;
        }
        var targetView = htmlViews[hit.Segment];
        targetView.SearchMatchStart = hit.Span.Start;
        targetView.SearchMatchLength = hit.Span.Length;

        if (!HtmlView.CanMeasureSearchMatch)
        {
            // Platforms without a text-layout hook still land on the segment.
            await ArticleScroll.ScrollToAsync(targetView, ScrollToPosition.Start, false);
            return;
        }
        // The native text layout arrives after the handler's async render —
        // poll until a measurable line position exists.
        for (var attempt = 0; attempt < 60; attempt++)
        {
            if (targetView.Handler != null && targetView.Height > 0 &&
                targetView.GetSearchMatchTop() is { } matchTop)
            {
                var y = Math.Max(0, ContentYOffset(targetView) + matchTop - 8);
                await ArticleScroll.ScrollToAsync(0, y, false);
                return;
            }
            await Task.Delay(50);
        }
        Console.Error.WriteLine($"Article search jump could not measure the match in article {target.ArticleId}.");
    }

    /// <summary>Accumulated Y of an element within the ScrollView's content.</summary>
    private double ContentYOffset(VisualElement element)
    {
        double y = 0;
        VisualElement? current = element;
        while (current != null && !ReferenceEquals(current, ArticleScroll.Content))
        {
            y += current.Y;
            current = current.Parent as VisualElement;
        }
        return y;
    }
}
