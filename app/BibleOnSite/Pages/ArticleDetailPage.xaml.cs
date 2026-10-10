using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using CommunityToolkit.Maui.Views;
using Microsoft.Maui.Controls.Shapes;

namespace BibleOnSite.Pages;

/// <summary>
/// Page displaying a single article's content.
/// </summary>
[QueryProperty(nameof(ArticleId), "articleId")]
[QueryProperty(nameof(PerekId), "perekId")]
public partial class ArticleDetailPage : ContentPage, IQueryAttributable
{
    private readonly ArticleDetailViewModel _viewModel;
    private readonly List<MediaElement> _mediaElements = [];
    private ArticleSearchResult? _searchJumpTarget;

    public int ArticleId { get; set; }
    public int PerekId { get; set; }

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

    public ArticleDetailPage()
    {
        InitializeComponent();
        _viewModel = new ArticleDetailViewModel();
        BindingContext = _viewModel;
        SetupFontSizeResources();
    }

    private void SetupFontSizeResources()
    {
        var prefs = PreferencesService.Instance;
        UpdateFontSizeResources(prefs.FontFactor);
        prefs.PreferencesChanged += (_, _) =>
            MainThread.BeginInvokeOnMainThread(() =>
                UpdateFontSizeResources(prefs.FontFactor));
    }

    private void UpdateFontSizeResources(double factor)
    {
        Resources["ArticleFontSize"] = factor * 16;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        if (ArticleId > 0)
        {
            await LoadArticleAsync();
        }
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        CleanupMediaElements();
    }

    private async Task LoadArticleAsync()
    {
        try
        {
            var article = await ArticleService.Instance.GetArticleByIdAsync(ArticleId);

            if (article != null)
            {
                _viewModel.SetArticle(article);
                BuildArticleContent(article.ArticleContent);
                await ApplySearchJumpAsync();
            }
            else
            {
                _viewModel.ErrorMessage = "לא נמצא מאמר";
            }
        }
        catch (Exception ex)
        {
            _viewModel.ErrorMessage = $"שגיאה בטעינת המאמר: {ex.Message}";
        }
    }

    private void BuildArticleContent(string? html)
    {
        ArticleContentContainer.Children.Clear();
        CleanupMediaElements();

        if (string.IsNullOrEmpty(html))
            return;

        if (!HtmlMediaExtractor.ContainsMedia(html))
        {
            ArticleContentContainer.Children.Add(CreateHtmlView(html));
            return;
        }

        var segments = HtmlMediaExtractor.ExtractSegments(html);
        foreach (var segment in segments)
        {
            switch (segment.Kind)
            {
                case SegmentKind.Html:
                    ArticleContentContainer.Children.Add(CreateHtmlView(segment.Html!));
                    break;

                case SegmentKind.Media when segment.Type == MediaType.Video:
                    ArticleContentContainer.Children.Add(CreateVideoPlayer(segment.MediaUrl!));
                    break;

                case SegmentKind.Media when segment.Type == MediaType.Audio:
                    ArticleContentContainer.Children.Add(CreateAudioPlayer(segment.MediaUrl!));
                    break;
            }
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

    private HtmlView CreateHtmlView(string html)
    {
        var view = new HtmlView
        {
            HtmlContent = html,
            LineHeight = 1.5,
            TextAlignment = HtmlTextAlignment.Justify,
            TextDirection = HtmlTextDirection.Rtl,
            HorizontalOptions = LayoutOptions.Fill
        };
        view.SetDynamicResource(HtmlView.FontSizeProperty, "ArticleFontSize");
        return view;
    }

    private View CreateVideoPlayer(string url)
    {
        var mediaElement = new MediaElement
        {
            Source = MediaSource.FromUri(url),
            ShouldAutoPlay = false,
            ShouldShowPlaybackControls = true,
            Aspect = Aspect.AspectFit,
            HeightRequest = 220,
            HorizontalOptions = LayoutOptions.Fill,
            BackgroundColor = Colors.Black
        };
        _mediaElements.Add(mediaElement);

        var container = new Border
        {
            StrokeShape = new RoundRectangle { CornerRadius = 8 },
            StrokeThickness = 0,
            Padding = 0,
            Content = mediaElement
        };
        return container;
    }

    private View CreateAudioPlayer(string url)
    {
        var mediaElement = new MediaElement
        {
            Source = MediaSource.FromUri(url),
            ShouldAutoPlay = false,
            ShouldShowPlaybackControls = true,
            HeightRequest = 80,
            HorizontalOptions = LayoutOptions.Fill
        };
        _mediaElements.Add(mediaElement);

        var container = new Border
        {
            StrokeShape = new RoundRectangle { CornerRadius = 8 },
            StrokeThickness = 1,
            Stroke = Application.Current?.RequestedTheme == AppTheme.Dark
                ? Color.FromArgb("#444444")
                : Color.FromArgb("#e0e0e0"),
            Padding = 0,
            Content = mediaElement
        };
        return container;
    }

    private void CleanupMediaElements()
    {
        foreach (var me in _mediaElements)
        {
            me.Stop();
            me.Handler?.DisconnectHandler();
        }
        _mediaElements.Clear();
    }
}
