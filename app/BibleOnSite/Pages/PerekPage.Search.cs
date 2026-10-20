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
    /// <summary>
    /// Target gap between the pasuk list's top edge and the landed match line.
    /// Large enough to keep the pasuk text and the perush-name header visible
    /// when the match sits near the note's start; deeper matches still land
    /// just below the toolbar. Tighter values let an early scroll push the
    /// name header offscreen before the visibility check settles (#2205).
    /// </summary>
    private const int MatchTopMargin = 96;
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
        // An enabled interactive-pop recognizer keeps claiming the right edge
        // even at the navigation root where nothing can pop. System edge
        // recognizers get edge touches before ordinary recognizers, so it can
        // win the race against the RTL flyout's pan and leave the drawer
        // gesture dead (#2432). Keep it on only while real history exists;
        // OnDisappearing restores it for pages pushed above.
        back.Enabled = Navigation.NavigationStack.Count > 1;
        // Native history owns the edge before the chapter carousel or verse list.
        // Keep UIKit's interactive pop and MAUI's navigation delegate intact.
        if (PerekCarousel.Handler?.PlatformView is UIKit.UIView carousel)
        {
            GiveNativeBackPriority(carousel, back);
        }
        DebugLog.Write($"[ReaderBack] stack={Navigation.NavigationStack.Count} enabled={back.Enabled} direction={navigation.View.EffectiveUserInterfaceLayoutDirection}");
    }

    /// <summary>
    /// Re-enables the system edge-back recognizer that
    /// <see cref="ConfigureIosReaderHistory"/> switches off at the navigation
    /// root, so a page pushed above this reader keeps its native back swipe.
    /// </summary>
    private void RestoreIosInteractiveBack()
    {
        if (Handler is IPlatformViewHandler pageHandler &&
            pageHandler.ViewController?.NavigationController?.InteractivePopGestureRecognizer is { } back)
        {
            back.Enabled = true;
        }
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
                    var perush = TryLandOnPerushMatch(list, target.Display, target.Span);
                    landed = perush == PerushLanding.Landed;
                    if (perush == PerushLanding.NotReady)
                    {
                        // The matched note row is not realized yet — keep the
                        // pasuk row pinned at the top so it materializes.
                        pasukScrolls = AnchorPasukRow(list, item, pasukScrolls);
                    }
                }
                else
                {
                    landed = LandOnPasukRow(list, item, ref pasukScrolls);
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
        var nativeList = GetNativeReaderCollection(FindReaderPasukList());
        Console.Error.WriteLine($"[SearchLanding] native={nativeList?.GetType().Name ?? "none"} offset={nativeList?.ContentOffset.Y} visible={string.Join(",", nativeList?.IndexPathsForVisibleItems?.Select(path => $"{path.Section}:{path.Item}") ?? [])}");
#endif
        Console.Error.WriteLine($"Search reader could not locate verse {pasukNum} in chapter {_viewModel.PerekId}.");
    }

    private CollectionView? FindReaderPasukList() => PerekCarousel
        .GetVisualTreeDescendants()
        .OfType<CollectionView>()
        .FirstOrDefault(view => ReferenceEquals(view.BindingContext, _viewModel.Perek)
            && view.Handler != null && view.Height > 0);

    /// <summary>
    /// Scrolls the pasuk row to the top of the list until the platform reports
    /// it actually arrived there. Returns the verification verdict: true only
    /// once the row is confirmed anchored (or, on platforms without a native
    /// position check, after enough scrolls were issued to trust the jump).
    /// </summary>
    private static bool LandOnPasukRow(CollectionView list, PasukDisplayItem item, ref int pasukScrolls)
    {
        // Scroll to the display item, not the logical Pasuk: the list's
        // ItemsSource holds PasukDisplayItem rows (שניים מקרא can duplicate
        // each pasuk), so a Pasuk target matched no row and the jump silently
        // failed.
        var anchored = IsItemAnchoredAtTop(list, item);
        pasukScrolls = AnchorPasukRow(list, item, pasukScrolls, anchored);
        // Platforms without a native position check accept the jump after a
        // few scroll issues instead of confirming the offset.
        return anchored ?? pasukScrolls >= 4;
    }

    private static int AnchorPasukRow(CollectionView list, PasukDisplayItem item, int pasukScrolls, bool? anchored = null)
    {
        if (anchored != true && pasukScrolls < 60)
        {
            list.ScrollTo(item, position: ScrollToPosition.Start, animate: false);
            pasukScrolls++;
        }
        return pasukScrolls;
    }

    /// <summary>Verdict of a perush match-scroll frame.</summary>
    private enum PerushLanding
    {
        /// <summary>The note row is not realized yet — keep anchoring the pasuk row.</summary>
        NotReady,
        /// <summary>A match scroll is in play but the line is not verified visible yet.</summary>
        Engaged,
        /// <summary>The match line sits inside the viewport (or is trusted to).</summary>
        Landed,
    }

    /// <summary>
    /// Finds the realized <see cref="HtmlView"/> bound to the matched note
    /// display, sets its normalized match span, and scrolls the pasuk list so
    /// the match lands just below the toolbar — re-issuing the scroll on every
    /// call until the match line verifies inside the viewport, because a
    /// recycled/re-laid-out cell can silently undo an earlier scroll.
    /// </summary>
    private static PerushLanding TryLandOnPerushMatch(CollectionView list, PerushNoteDisplay display, SearchMatchSpan span)
    {
        var htmlView = list.GetVisualTreeDescendants().OfType<HtmlView>()
            .FirstOrDefault(view => ReferenceEquals(view.BindingContext, display));
        if (htmlView == null)
        {
            return PerushLanding.NotReady; // Note views for this pasuk are not realized yet.
        }
        if (!htmlView.HasSearchMatch)
        {
            htmlView.SearchMatchStart = span.Start;
            htmlView.SearchMatchLength = span.Length;
        }
        var visible = IsMatchLineVisible(list, htmlView);
        // The landing is only complete when the perush-name header shares the
        // viewport with the match — visibility of the match line alone can
        // leave the header scrolled offscreen (#2205).
        var nameLabel = FindPerushNameLabel(list, display);
        var nameVisible = nameLabel == null ? null : IsElementVisible(list, nameLabel);
        if (visible == true && nameVisible != false)
        {
            return PerushLanding.Landed;
        }
        // The match is in view but its perush-name header is offscreen. When
        // both can share the viewport, scroll the header in and re-verify.
        // When they cannot (a very long pasuk), the match-only landing is the
        // final state — re-pinning the match every frame would never settle.
        // A null fit means the label's platform view is still attaching — stay
        // engaged one more frame instead of accepting a headerless landing.
        if (visible == true && nameVisible == false)
        {
            var fits = NameAndMatchFit(list, htmlView, nameLabel!);
            if (fits == true)
            {
                ScrollNameToMargin(list, nameLabel!);
            }
            // Fit the header in and re-verify next frame; an unmeasurable fit
            // (platform view still attaching) also stays engaged. Only a
            // proven non-fit accepts the match-only landing.
            return fits == false ? PerushLanding.Landed : PerushLanding.Engaged;
        }
        if (!ScrollListToMatch(list, htmlView))
        {
            // The scroll primitives are not ready (no layout yet). When the
            // platform cannot verify visibility we still report Engaged so
            // the pasuk-row anchoring does not fight the pending scroll.
            return visible == null ? PerushLanding.Engaged : PerushLanding.NotReady;
        }
        // Verified platforms re-check visibility next frame; unverifiable
        // platforms trust the issued scroll.
        return visible == null ? PerushLanding.Landed : PerushLanding.Engaged;
    }

    /// <summary>
    /// Finds the <see cref="Label"/> carrying the perush name bound to the same
    /// note display as the matched <see cref="HtmlView"/> — both realize
    /// together inside one cell of the notes template.
    /// </summary>
    private static Label? FindPerushNameLabel(CollectionView list, PerushNoteDisplay display)
    {
        return list.GetVisualTreeDescendants().OfType<Label>()
            .FirstOrDefault(label =>
                label.AutomationId == "InlinePerushName" &&
                ReferenceEquals(label.BindingContext, display));
    }

    /// <summary>
    /// True when the element's center is inside the list viewport; false when
    /// it is not; null when the platform cannot measure it. Center-based to
    /// match what e2e visibility checks accept.
    /// </summary>
    private static bool? IsElementVisible(CollectionView list, VisualElement element)
    {
#if ANDROID
        if (element.Handler?.PlatformView is not Android.Views.View view ||
            list.Handler?.PlatformView is not AndroidX.RecyclerView.Widget.RecyclerView recycler)
        {
            return false;
        }
        var viewPos = new int[2];
        var listPos = new int[2];
        view.GetLocationOnScreen(viewPos);
        recycler.GetLocationOnScreen(listPos);
        var centerY = viewPos[1] + view.Height / 2;
        return centerY >= listPos[1] && centerY <= listPos[1] + recycler.Height;
#elif IOS || MACCATALYST
        if (element.Handler?.PlatformView is not UIKit.UIView view ||
            GetNativeReaderCollection(list) is not { } collection)
        {
            return false;
        }
        var point = view.ConvertPointToView(
            new CoreGraphics.CGPoint(0, view.Bounds.Height / 2), collection);
        var top = collection.ContentOffset.Y;
        var bottom = top + collection.Bounds.Height - collection.AdjustedContentInset.Top;
        return point.Y >= top && point.Y <= bottom;
#else
        _ = list; // No measurement without the platform views.
        _ = element;
        return null;
#endif
    }

    /// <summary>
    /// Whether the perush-name header and the match line can share the viewport
    /// once the header lands <see cref="MatchTopMargin"/> below the list top;
    /// null when either side cannot be measured on this platform.
    /// </summary>
    private static bool? NameAndMatchFit(CollectionView list, HtmlView htmlView, Label nameLabel)
    {
#if ANDROID
        if (htmlView.GetSearchMatchTop() is not { } matchTop ||
            htmlView.Handler?.PlatformView is not Android.Views.View noteView ||
            nameLabel.Handler?.PlatformView is not Android.Views.View labelView ||
            list.Handler?.PlatformView is not AndroidX.RecyclerView.Widget.RecyclerView recycler)
        {
            return null;
        }
        var notePos = new int[2];
        var labelPos = new int[2];
        noteView.GetLocationOnScreen(notePos);
        labelView.GetLocationOnScreen(labelPos);
        var density = noteView.Resources?.DisplayMetrics?.Density ?? 1f;
        var gap = notePos[1] + matchTop * density - labelPos[1];
        return gap <= recycler.Height - MatchTopMargin * density;
#elif IOS || MACCATALYST
        if (htmlView.GetSearchMatchTop() is not { } matchTop ||
            htmlView.Handler?.PlatformView is not UIKit.UIView noteView ||
            nameLabel.Handler?.PlatformView is not UIKit.UIView labelView ||
            GetNativeReaderCollection(list) is not { } collection)
        {
            return null;
        }
        var matchY = noteView.ConvertPointToView(new CoreGraphics.CGPoint(0, matchTop), collection).Y;
        var nameY = labelView.ConvertPointToView(new CoreGraphics.CGPoint(0, 0), collection).Y;
        return matchY - nameY <=
            collection.Bounds.Height - collection.AdjustedContentInset.Top - MatchTopMargin;
#else
        _ = list;
        _ = htmlView;
        _ = nameLabel;
        return null;
#endif
    }

    /// <summary>
    /// Scrolls the list so the perush-name header lands
    /// <see cref="MatchTopMargin"/> below the list top, exposing the header
    /// while keeping the match inside the viewport.
    /// </summary>
    private static bool ScrollNameToMargin(CollectionView list, Label nameLabel)
    {
#if ANDROID
        if (nameLabel.Handler?.PlatformView is not Android.Views.View labelView ||
            list.Handler?.PlatformView is not AndroidX.RecyclerView.Widget.RecyclerView recycler)
        {
            return false;
        }
        var labelPos = new int[2];
        var listPos = new int[2];
        labelView.GetLocationOnScreen(labelPos);
        recycler.GetLocationOnScreen(listPos);
        var density = labelView.Resources?.DisplayMetrics?.Density ?? 1f;
        recycler.ScrollBy(0, (int)(labelPos[1] - listPos[1] - MatchTopMargin * density));
        return true;
#elif IOS || MACCATALYST
        if (nameLabel.Handler?.PlatformView is not UIKit.UIView labelView ||
            GetNativeReaderCollection(list) is not { } collection)
        {
            return false;
        }
        var point = labelView.ConvertPointToView(new CoreGraphics.CGPoint(0, 0), collection);
        var target = point.Y - MatchTopMargin;
        var min = -collection.AdjustedContentInset.Top;
        var max = Math.Max(min, collection.ContentSize.Height - collection.Bounds.Height + collection.AdjustedContentInset.Bottom);
        collection.SetContentOffset(
            new CoreGraphics.CGPoint(collection.ContentOffset.X, Math.Clamp(target, min, max)), false);
        return true;
#else
        _ = list;
        _ = nameLabel;
        return true;
#endif
    }

    /// <summary>
    /// True when the row bound to <paramref name="item"/> is the first visible
    /// row of the list; false when it is not; null when the platform has no
    /// native position check and the verdict cannot be verified.
    /// </summary>
    private static bool? IsItemAnchoredAtTop(CollectionView list, object item)
    {
#if ANDROID
        if (list.Handler?.PlatformView is AndroidX.RecyclerView.Widget.RecyclerView recycler &&
            recycler.GetLayoutManager() is AndroidX.RecyclerView.Widget.LinearLayoutManager layout)
        {
            var index = IndexOfItem(list, item);
            return index >= 0 && layout.FindFirstVisibleItemPosition() == index;
        }
        return false;
#elif IOS || MACCATALYST
        if (GetNativeReaderCollection(list) is { } collection)
        {
            var index = IndexOfItem(list, item);
            var paths = collection.IndexPathsForVisibleItems;
            return index >= 0 && paths is { Length: > 0 } && paths.Min(path => (int)path.Item) == index;
        }
        return false;
#else
        _ = list; // No native position check on this platform.
        _ = item;
        return null;
#endif
    }

    /// <summary>
    /// True when the match line of the note view is inside the list viewport;
    /// false when it is not; null when the platform cannot measure it.
    /// </summary>
    private static bool? IsMatchLineVisible(CollectionView list, HtmlView htmlView)
    {
#if ANDROID
        if (htmlView.GetSearchMatchTop() is not { } matchTop ||
            htmlView.Handler?.PlatformView is not Android.Views.View noteView ||
            list.Handler?.PlatformView is not AndroidX.RecyclerView.Widget.RecyclerView recycler)
        {
            return false;
        }
        var viewPos = new int[2];
        var listPos = new int[2];
        noteView.GetLocationOnScreen(viewPos);
        recycler.GetLocationOnScreen(listPos);
        var density = noteView.Resources?.DisplayMetrics?.Density ?? 1f;
        var matchY = viewPos[1] + matchTop * density;
        return matchY >= listPos[1] && matchY <= listPos[1] + recycler.Height - density;
#elif IOS || MACCATALYST
        if (htmlView.GetSearchMatchTop() is not { } matchTop ||
            htmlView.Handler?.PlatformView is not UIKit.UIView noteView ||
            GetNativeReaderCollection(list) is not { } collection)
        {
            return false;
        }
        var point = noteView.ConvertPointToView(new CoreGraphics.CGPoint(0, matchTop), collection);
        var top = collection.ContentOffset.Y;
        var bottom = top + collection.Bounds.Height - collection.AdjustedContentInset.Top;
        return point.Y >= top && point.Y <= bottom;
#else
        _ = list; // No measurement without the platform views.
        _ = htmlView;
        return null;
#endif
    }

#if IOS || MACCATALYST
    // Optimized MAUI handlers expose the controller's UIView. Accept both a
    // collection root and a collection nested inside that native view.
    private static UIKit.UICollectionView? GetNativeReaderCollection(CollectionView? list) =>
        list?.Handler?.PlatformView switch
        {
            UIKit.UICollectionView collection => collection,
            UIKit.UIView view => FindDescendantCollectionView(view),
            _ => null
        };
#endif

    private static int IndexOfItem(CollectionView list, object item)
    {
        var index = 0;
        foreach (var entry in list.ItemsSource?.Cast<object>() ?? [])
        {
            if (ReferenceEquals(entry, item))
            {
                return index;
            }
            index++;
        }
        return -1;
    }

    private static bool ScrollListToMatch(CollectionView list, HtmlView htmlView)
    {
#if ANDROID
        if (htmlView.GetSearchMatchTop() is not { } matchTop ||
            htmlView.Handler?.PlatformView is not Android.Views.View noteView ||
            list.Handler?.PlatformView is not AndroidX.RecyclerView.Widget.RecyclerView recycler)
        {
            return false;
        }
        var viewPos = new int[2];
        var listPos = new int[2];
        noteView.GetLocationOnScreen(viewPos);
        recycler.GetLocationOnScreen(listPos);
        var density = noteView.Resources?.DisplayMetrics?.Density ?? 1f;
        recycler.ScrollBy(0, (int)(viewPos[1] + matchTop * density - listPos[1] - MatchTopMargin * density));
        return true;
#elif IOS || MACCATALYST
        if (htmlView.GetSearchMatchTop() is not { } matchTop ||
            htmlView.Handler?.PlatformView is not UIKit.UIView noteView ||
            GetNativeReaderCollection(list) is not { } collection)
        {
            return false;
        }
        // Scroll-view coordinates are content space, so the converted point is
        // already a content offset.
        var point = noteView.ConvertPointToView(new CoreGraphics.CGPoint(0, matchTop), collection);
        var target = point.Y - MatchTopMargin;
        var min = -collection.AdjustedContentInset.Top;
        var max = Math.Max(min, collection.ContentSize.Height - collection.Bounds.Height + collection.AdjustedContentInset.Bottom);
        collection.SetContentOffset(
            new CoreGraphics.CGPoint(collection.ContentOffset.X, Math.Clamp(target, min, max)), false);
        return true;
#else
        // No per-line measurement on this platform: the pasuk-row scroll is the landing.
        _ = list;
        _ = htmlView;
        return true;
#endif
    }
}
