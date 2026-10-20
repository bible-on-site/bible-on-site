using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using Microsoft.Maui.Controls.Shapes;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Pages;

#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class PerekPage
#pragma warning restore S2333
{
    private bool _preserveSearchOnDisappear;
    private SearchResult? _searchReaderResult;

    /// <summary>Perek requested via the calendarReader?perekId= query route.</summary>
    private int? _pendingPerekId;
    private View? _searchHeader;
    private double _searchHeaderHeight;
    private const string SearchExpansionAnimation = "ReaderSearchExpansion";
    private const string SearchIntroductionAnimation = "ReaderSearchIntroduction";
    private bool _searchIntroductionPending = true;

    private void InitializeSearchHeader()
    {
        _searchHeader = ChapterSearch.DetachHeader();
        _searchHeaderHeight = _searchHeader.HeightRequest;
    }

    private async void OnPerekSourceClicked(object? sender, EventArgs e)
    {
        ReaderMenuOverlay.IsVisible = false;
        var sourceBounds = SearchIntroduction.IsVisible ? SearchIntroduction.Bounds : NormalNavigationTitle.Bounds;
        FinishSearchIntroduction();
        var opening = ChapterSearch.OpenAsync();
        await AnimateSearchExpansionAsync(sourceBounds);
        await opening;
        if (ChapterSearch.IsSearchOpen)
        {
            ChapterSearch.FocusInput();
        }
    }

    private void OnChapterSearchOpenChanged(object? sender, EventArgs e)
    {
        if (!ChapterSearch.IsSearchOpen)
        {
            this.AbortAnimation(SearchExpansionAnimation);
            ResetSearchHeader();
        }
        UpdateSelectionBar();
    }

    private Task AnimateSearchExpansionAsync(Rect sourceBounds)
    {
        var availableWidth = ReaderToolbar.Width - SearchTitleHost.Margin.HorizontalThickness;
        if (_searchHeader is not Border header || availableWidth <= 0 || sourceBounds.Width <= 0)
        {
            return Task.CompletedTask;
        }
#if IOS
        if (UIKit.UIAccessibility.IsReduceMotionEnabled)
        {
            return Task.CompletedTask;
        }
#endif
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var startWidth = Math.Min(sourceBounds.Width, availableWidth);
        var startOffset = sourceBounds.Right - (ReaderToolbar.Width - SearchTitleHost.Margin.Right);
        var startColor = NormalNavigationTitle.BackgroundColor;
        var endColor = header.BackgroundColor;
        var content = header.Content as View;
        header.IsEnabled = false;
        SearchTitleHost.HorizontalOptions = LayoutOptions.Start;
        var animation = new Animation(progress =>
        {
            SearchTitleHost.WidthRequest = startWidth + (availableWidth - startWidth) * progress;
            SearchTitleHost.TranslationX = startOffset * (1 - progress);
            header.HeightRequest = sourceBounds.Height + (_searchHeaderHeight - sourceBounds.Height) * progress;
            header.BackgroundColor = new Color(
                (float)(startColor.Red + (endColor.Red - startColor.Red) * progress),
                (float)(startColor.Green + (endColor.Green - startColor.Green) * progress),
                (float)(startColor.Blue + (endColor.Blue - startColor.Blue) * progress));
            if (header.StrokeShape is RoundRectangle shape)
            {
                shape.CornerRadius = new CornerRadius(14 * (1 - progress));
            }
            if (content != null)
            {
                content.Opacity = Math.Clamp((progress - 0.3) / 0.7, 0, 1);
            }
        });
        animation.Commit(this, SearchExpansionAnimation, 16, 220, Easing.CubicOut, (_, _) =>
        {
            ResetSearchHeader();
            completion.TrySetResult(true);
        });
        return completion.Task;
    }

    private void ResetSearchHeader()
    {
        SearchTitleHost.WidthRequest = -1;
        SearchTitleHost.TranslationX = 0;
        SearchTitleHost.HorizontalOptions = LayoutOptions.Fill;
        if (_searchHeader is Border header)
        {
            header.HeightRequest = _searchHeaderHeight;
            header.IsEnabled = true;
            header.SetAppThemeColor(Border.BackgroundColorProperty, Color.FromArgb("#F2F7FE"), Color.FromArgb("#20304A"));
            if (header.StrokeShape is RoundRectangle shape)
            {
                shape.CornerRadius = new CornerRadius(0);
            }
            if (header.Content is View content)
            {
                content.Opacity = 1;
            }
        }
    }

    private void StartSearchIntroduction()
    {
        if (ChapterSearch.IsSearchOpen || !NormalNavigationBar.IsVisible)
        {
            return;
        }
        FinishSearchIntroduction();
        _searchIntroductionPending = true;
        SearchIntroduction.IsVisible = true;
        SearchIntroduction.Opacity = 0;
        SearchIntroduction.WidthRequest = -1;
        SearchIntroductionText.Opacity = 1;
        SearchIntroductionText.Scale = 1;
#if IOS
        if (UIKit.UIAccessibility.IsReduceMotionEnabled)
        {
            FinishSearchIntroduction();
            return;
        }
#endif
        NormalNavigationTitle.IsVisible = true;
        // The permanent navigation control stays available during loading and
        // search landing. Animate only the decorative introduction above it.
        NormalNavigationTitle.Opacity = 1;
        var sourceWidth = NormalNavigationBar.Width - 2 * ReaderNavigationButton.Width - NormalNavigationTitle.Margin.HorizontalThickness;
        var introductionWidth = Math.Min(ReaderToolbar.Width - 8, sourceWidth * 1.06);
        if (sourceWidth <= 0 || introductionWidth <= 0)
        {
            FinishSearchIntroduction();
            return;
        }
        SearchIntroduction.HorizontalOptions = LayoutOptions.Center;
        var animation = new Animation(progress =>
        {
            var reveal = Math.Min(progress / 0.18, 1);
            var contraction = Easing.CubicInOut.Ease(Math.Clamp((progress - 0.6) / 0.4, 0, 1));
            SearchIntroduction.Opacity = reveal * (1 - contraction);
            SearchIntroduction.Scale = 0.96 + 0.04 * reveal;
            SearchIntroduction.WidthRequest = introductionWidth + (sourceWidth - introductionWidth) * contraction;
            SearchIntroductionText.Opacity = 1 - contraction;
            SearchIntroductionText.Scale = 1 - 0.2 * contraction;

        });
        animation.Commit(this, SearchIntroductionAnimation, 16, 1400, Easing.Linear, (_, _) => FinishSearchIntroduction());
    }

    private void FinishSearchIntroduction()
    {
        if (!_searchIntroductionPending)
        {
            return;
        }
        _searchIntroductionPending = false;
        this.AbortAnimation(SearchIntroductionAnimation);
        SearchIntroduction.IsVisible = false;
        SearchIntroduction.HorizontalOptions = LayoutOptions.Fill;
        SearchIntroduction.WidthRequest = -1;
        NormalNavigationTitle.IsVisible = true;
        NormalNavigationTitle.Opacity = 1;
    }

#if IOS
    private void ConfigureIosReaderHistory()
    {
        if (Handler is not IPlatformViewHandler pageHandler ||
            pageHandler.ViewController?.NavigationController is not { } navigation ||
            navigation.InteractivePopGestureRecognizer is not { } back)
        {
            return;
        }
        navigation.View!.SemanticContentAttribute = UIKit.UISemanticContentAttribute.ForceRightToLeft;
        if (Navigation.NavigationStack.Count > 1)
        {
            back.Enabled = true;
        }
        // Native history owns the edge before the chapter carousel or verse list.
        // Keep UIKit's interactive pop and MAUI's navigation delegate intact.
        if (PerekCarousel.Handler?.PlatformView is UIKit.UIView carousel)
        {
            GiveNativeBackPriority(carousel, back);
        }
        DebugLog.Write($"[ReaderBack] stack={Navigation.NavigationStack.Count} enabled={back.Enabled} direction={navigation.View.EffectiveUserInterfaceLayoutDirection}");
    }

    private static void GiveNativeBackPriority(UIKit.UIView view, UIKit.UIGestureRecognizer back)
    {
        if (view is UIKit.UIScrollView scroll)
        {
            scroll.PanGestureRecognizer.RequireGestureRecognizerToFail(back);
        }
        foreach (var child in view.Subviews)
        {
            GiveNativeBackPriority(child, back);
        }
    }
#endif

    private void OnReaderMenuClicked(object? sender, EventArgs e) => Shell.Current.FlyoutIsPresented = true;

    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (query.TryGetValue("searchResult", out var value) && value is SearchResult result && GetSearchPerekId(result) > 0)
        {
            _searchReaderResult = result;
            // A genuinely new navigation request supersedes the remembered
            // fresh-load target — only the retry button reuses _initialPerekId.
            _initialPerekId = null;
        }

        // The daily-learning calendar pushes calendarReader?perekId=N above it.
        if (query.TryGetValue("perekId", out var perekValue) &&
            int.TryParse(perekValue?.ToString(), out var perekId) &&
            perekId is >= 1 and <= 929)
        {
            _pendingPerekId = perekId;
            _initialPerekId = null;
        }
    }

    private static int GetSearchPerekId(SearchResult result) => result switch
    {
        PerekSearchResult chapter => chapter.Perek.PerekId,
        PasukSearchResult verse => verse.PerekId,
        PerushSearchResult commentary => commentary.PerekId,
        _ => 0
    };

#pragma warning disable S1172 // The XAML event delegate requires the sender parameter.
    private async void OnSearchResultSelected(object? sender, SearchResult result)
#pragma warning restore S1172
    {
        if (_preserveSearchOnDisappear)
        {
            return;
        }
        _preserveSearchOnDisappear = true;
        try
        {
            if (result is AuthorSearchResult author)
            {
                await Shell.Current.GoToAsync($"ArticlesPage?authorId={author.Author.Id}&authorName={Uri.EscapeDataString(author.Author.Name)}");
            }
            else if (result is ArticleSearchResult article)
            {
                // Excerpt + phrase fully describe the jump target; plain query
                // parameters keep the destination self-contained and survive
                // Shell's string-only query handling (#2078).
                await Shell.Current.GoToAsync(
                    $"articleDetail?articleId={article.ArticleId}&perekId={article.PerekId}" +
                    $"&searchExcerpt={Uri.EscapeDataString(article.Excerpt)}" +
                    $"&searchPhrase={Uri.EscapeDataString(article.SearchPhrase)}");
            }
            else if (result is TanahpediaSearchResult entry)
            {
                // UniqueName is the canonical slug — alias hits already resolve
                // server-side, so this always opens the right entry (#2104).
                await Shell.Current.GoToAsync(
                    $"tanahpediaEntry?uniqueName={Uri.EscapeDataString(entry.UniqueName)}");
            }
            else if (GetSearchPerekId(result) > 0)
            {
                await Shell.Current.GoToAsync(AppRoutes.SearchReader, false, new ShellNavigationQueryParameters
                {
                    ["searchResult"] = result
                });
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Search navigation failed: {ex}");
            await DisplayAlertAsync("חיפוש", "לא ניתן לפתוח את תוצאת החיפוש. נסו שוב", "אישור");
        }
        finally
        {
            _preserveSearchOnDisappear = false;
        }
    }

    private async Task ApplySearchReaderLocationAsync()
    {
        var result = _searchReaderResult;
        _searchReaderResult = null;
        var pasukNum = result switch
        {
            PasukSearchResult verse => verse.Pasuk.PasukNum,
            PerushSearchResult commentary => commentary.PasukNum,
            _ => 0
        };
        var noteHit = result as PerushSearchResult;
        if (noteHit != null &&
            int.TryParse(noteHit.PerushId, out var perushId) &&
            !_viewModel.IsPerushChecked(perushId))
        {
            // Reveal the matched perush before measuring — enabling it changes
            // the pasuk cell's height and renders its note views.
            _viewModel.ShowPerushForSearch(perushId);
        }
        if (_viewModel.Perek?.Pasukim.FirstOrDefault(pasuk => pasuk.PasukNum == pasukNum) is not { } pasuk)
        {
            return;
        }
        // Identity comes from the note row that produced the hit, not from the
        // first rendered note for the pasuk — sibling notes can hold the same
        // query words (#2078).
        var matchTarget = noteHit == null
            ? null
            : await SearchMatch.ResolvePerushTargetAsync(noteHit, pasuk.PerushNotes);

        // The carousel realizes its chapter list after the page is laid out,
        // and a just-enabled perush repaints its note views asynchronously —
        // keep polling until the pasuk row, its HtmlView and the text layout
        // are all realized and measurable. The landing is re-verified on every
        // frame: a scroll issued while the CarouselView is still settling its
        // item views can be silently reset, leaving the jump at the top of the
        // chapter (#2078).
        var stableFrames = 0;
        var pasukScrolls = 0;
        for (var attempt = 0; attempt < 120; attempt++)
        {
            var list = FindReaderPasukList();
            // A perush hit anchors the copy that hosts the notes — the last copy
            // in שניים מקרא (#2403); a pasuk hit keeps the first/marked copy.
            var item = list?.ItemsSource?.Cast<object>().OfType<PasukDisplayItem>()
                .FirstOrDefault(display => display.PasukNum == pasukNum &&
                    (matchTarget == null ? display.IsFirstCopy : display.IsLastCopy));
            if (list != null && item != null)
            {
                bool landed;
                if (matchTarget is { } target)
                {
                    var perush = SearchMatchLanding.TryLandOnPerushMatch(list, target.Display, target.Span);
                    landed = perush == SearchMatchLanding.PerushLanding.Landed;
                    if (perush == SearchMatchLanding.PerushLanding.NotReady)
                    {
                        // The matched note row is not realized yet — keep the
                        // pasuk row pinned at the top so it materializes.
                        pasukScrolls = SearchMatchLanding.AnchorPasukRow(list, item, pasukScrolls);
                    }
                }
                else
                {
                    (landed, pasukScrolls) = SearchMatchLanding.LandOnPasukRow(list, item, pasukScrolls);
                }
                stableFrames = landed ? stableFrames + 1 : 0;
                if (stableFrames >= 4)
                {
                    return;
                }
            }
            await Task.Delay(50);
        }
#if IOS || MACCATALYST
        var nativeList = SearchMatchLanding.GetNativeReaderCollection(FindReaderPasukList());
        Console.Error.WriteLine($"[SearchLanding] native={nativeList?.GetType().Name ?? "none"} offset={nativeList?.ContentOffset.Y} visible={string.Join(",", nativeList?.IndexPathsForVisibleItems?.Select(path => $"{path.Section}:{path.Item}") ?? [])}");
#endif
        Console.Error.WriteLine($"Search reader could not locate verse {pasukNum} in chapter {_viewModel.PerekId}.");
    }

    private CollectionView? FindReaderPasukList() => PerekCarousel
        .GetVisualTreeDescendants()
        .OfType<CollectionView>()
        .FirstOrDefault(view => ReferenceEquals(view.BindingContext, _viewModel.Perek)
            && view.Handler != null && view.Height > 0);
}
