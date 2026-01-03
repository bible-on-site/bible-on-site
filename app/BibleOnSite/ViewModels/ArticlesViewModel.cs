using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Models;
using System.Collections.ObjectModel;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for displaying articles related to a perek.
/// </summary>
public partial class ArticlesViewModel : ObservableObject
{
#pragma warning disable MVVMTK0045
    [ObservableProperty]
    private int _perekId;

    [ObservableProperty]
    private string _perekTitle = string.Empty;

    [ObservableProperty]
    private ObservableCollection<Article> _articles = new();

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private bool _hasArticles;

    [ObservableProperty]
    private string _errorMessage = string.Empty;
#pragma warning restore MVVMTK0045

    public ArticlesViewModel()
    {
    }

    public ArticlesViewModel(int perekId, string perekTitle)
    {
        _perekId = perekId;
        _perekTitle = perekTitle;
    }

#if MAUI
    /// <summary>
    /// Loads articles for the current perek from the API.
    /// </summary>
    [RelayCommand]
    public async Task LoadArticlesAsync()
    {
        if (PerekId <= 0)
            return;

        try
        {
            IsLoading = true;
            ErrorMessage = string.Empty;

            var articles = await Services.ArticleService.Instance.GetArticlesByPerekIdAsync(PerekId);

            Articles.Clear();
            foreach (var article in articles)
            {
                Articles.Add(article);
            }

            HasArticles = Articles.Count > 0;
        }
        catch (Exception ex)
        {
            ErrorMessage = $"שגיאה בטעינת המאמרים: {ex.Message}";
            Console.Error.WriteLine($"Error loading articles: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>
    /// Opens an article for reading.
    /// </summary>
    [RelayCommand]
    public async Task OpenArticleAsync(Article article)
    {
        if (article == null)
            return;

        // Navigate to article detail page
        await Shell.Current.GoToAsync($"articleDetail?articleId={article.Id}&perekId={article.PerekId}");
    }
#endif
}
