using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Models;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for displaying authors list.
/// </summary>
public partial class AuthorsViewModel : ObservableObject
{
#pragma warning disable MVVMTK0045
    [ObservableProperty]
    private ObservableCollection<Author> _authors = new();

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private string _errorMessage = string.Empty;
#pragma warning restore MVVMTK0045

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

            Authors.Clear();
            foreach (var author in Services.StarterService.Instance.Authors)
            {
                Authors.Add(author);
            }
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
