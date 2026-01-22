using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Models;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for displaying authors list with search functionality.
/// </summary>
public partial class AuthorsViewModel : ObservableObject
{
    private const string SearchPhraseAll = "*";

#pragma warning disable MVVMTK0045
    [ObservableProperty]
    private ObservableCollection<Author> _authors = new();

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(FilteredAuthors))]
    private string _searchPhrase = string.Empty;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private string _errorMessage = string.Empty;
#pragma warning restore MVVMTK0045

    /// <summary>
    /// Gets the optimized search phrase with whitespace trimmed and "הרב" prefix removed.
    /// </summary>
    public string OptimizedSearchPhrase
    {
        get
        {
            if (string.IsNullOrWhiteSpace(SearchPhrase))
                return SearchPhraseAll;

            return SearchPhrase.Trim().Replace("הרב ", string.Empty);
        }
    }

    /// <summary>
    /// Gets the filtered list of authors based on the search phrase.
    /// </summary>
    public List<Author> FilteredAuthors
    {
        get
        {
            if (OptimizedSearchPhrase == SearchPhraseAll)
                return Authors.ToList();

            var searchTerm = OptimizedSearchPhrase.ToLowerInvariant();

            return Authors
                .Where(author =>
                {
                    // Search in name (removing "הרב" prefix for matching)
                    var nameWithoutPrefix = author.Name.Replace("הרב ", string.Empty);
                    return nameWithoutPrefix.Contains(searchTerm, StringComparison.OrdinalIgnoreCase) ||
                           author.Name.Contains(searchTerm, StringComparison.OrdinalIgnoreCase);
                })
                .ToList();
        }
    }

    /// <summary>
    /// Sets the authors collection (useful for testing and initialization).
    /// </summary>
    public void SetAuthors(IEnumerable<Author> authors)
    {
        Authors.Clear();
        foreach (var author in authors)
        {
            Authors.Add(author);
        }
        OnPropertyChanged(nameof(FilteredAuthors));
    }

#if MAUI
    [RelayCommand]
    public async Task LoadAuthorsAsync()
    {
        try
        {
            IsLoading = true;
            ErrorMessage = string.Empty;

            if (!Services.StarterService.Instance.IsLoaded)
            {
                await Services.StarterService.Instance.LoadAsync();
            }

            SetAuthors(Services.StarterService.Instance.Authors);
        }
        catch (Exception ex)
        {
            ErrorMessage = $"שגיאה בטעינת הרבנים: {ex.Message}";
            Console.Error.WriteLine($"Error loading authors: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }
#endif
}
