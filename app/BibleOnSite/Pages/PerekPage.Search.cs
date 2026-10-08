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
        NormalNavigationTitle.Opacity = 0;
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
            SearchIntroduction.Opacity = reveal;
            SearchIntroduction.Scale = 0.96 + 0.04 * reveal;
            SearchIntroduction.WidthRequest = introductionWidth + (sourceWidth - introductionWidth) * contraction;
            SearchIntroductionText.Opacity = 1 - contraction;
            SearchIntroductionText.Scale = 1 - 0.2 * contraction;
            NormalNavigationTitle.Opacity = contraction;
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
            navigation.InteractivePopGestureRecognizer is not { } back ||
            PerekCarousel.Handler?.PlatformView is not UIKit.UIView carousel)
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
        GiveNativeBackPriority(carousel, back);
        Console.WriteLine($"[ReaderBack] stack={Navigation.NavigationStack.Count} enabled={back.Enabled} direction={navigation.View.EffectiveUserInterfaceLayoutDirection}");
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
        if (result is PerushSearchResult note && int.TryParse(note.PerushId, out var perushId) && !_viewModel.IsPerushChecked(perushId))
        {
            _viewModel.ToggleCheckedPerush(perushId);
        }
        if (_viewModel.Perek?.Pasukim.FirstOrDefault(pasuk => pasuk.PasukNum == pasukNum) is not { } pasuk)
        {
            return;
        }

        // The carousel realizes its chapter list after the page is laid out.
        // Scroll the ordinary reader instead of entering verse-selection mode.
        for (var attempt = 0; attempt < 40; attempt++)
        {
            var list = PerekCarousel.GetVisualTreeDescendants().OfType<CollectionView>()
                .FirstOrDefault(view => view.BindingContext == _viewModel.Perek && view.Handler != null && view.Height > 0);
            if (list != null)
            {
                list.ScrollTo(pasuk, position: ScrollToPosition.Start, animate: false);
                return;
            }
            await Task.Delay(50);
        }
        Console.Error.WriteLine($"Search reader could not locate verse {pasukNum} in chapter {_viewModel.PerekId}.");
    }
}
