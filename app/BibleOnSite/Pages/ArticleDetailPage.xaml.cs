using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// Page displaying a single article's content.
/// </summary>
[QueryProperty(nameof(ArticleId), "articleId")]
[QueryProperty(nameof(PerekId), "perekId")]
public partial class ArticleDetailPage : ContentPage
{
    private readonly ArticleDetailViewModel _viewModel;

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
#if IOS
        ArticleContentView?.InvalidateMeasure();
#endif
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        if (ArticleId > 0)
        {
            await LoadArticleAsync();
        }
    }

    private async Task LoadArticleAsync()
    {
        try
        {
            var article = await ArticleService.Instance.GetArticleByIdAsync(ArticleId);

            if (article != null)
            {
                _viewModel.SetArticle(article);
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
}
