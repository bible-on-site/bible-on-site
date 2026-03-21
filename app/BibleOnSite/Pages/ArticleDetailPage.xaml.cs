using BibleOnSite.Controls;
using BibleOnSite.Helpers;
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
public partial class ArticleDetailPage : ContentPage
{
    private readonly ArticleDetailViewModel _viewModel;
    private readonly List<MediaElement> _mediaElements = [];

    public int ArticleId { get; set; }
    public int PerekId { get; set; }

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
