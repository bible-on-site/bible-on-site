using CommunityToolkit.Mvvm.ComponentModel;
using BibleOnSite.Services;

namespace BibleOnSite.ViewModels;

/// <summary>
/// Observable visibility state for the Shell flyout menu entries gated behind
/// preferences. The flyout content inflates from a DataTemplate outside any
/// page BindingContext, so it binds to <see cref="Instance"/> via x:Static;
/// this type exists to make that binding reactive (INotifyPropertyChanged)
/// and unit-testable without a live Shell.
/// </summary>
public class FlyoutMenuState : ObservableObject
{
    private static readonly Lazy<FlyoutMenuState> _instance =
        new(() => new FlyoutMenuState(PreferencesService.Instance));

    /// <summary>The shared instance bound by the Shell flyout template.</summary>
    public static FlyoutMenuState Instance => _instance.Value;

    private readonly PreferencesService _preferencesService;

    public FlyoutMenuState(PreferencesService preferencesService)
    {
        _preferencesService = preferencesService;
        _preferencesService.PreferencesChanged += OnPreferencesChanged;
    }

    /// <summary>
    /// Whether the מסורה על הפרק flyout entry is visible. Tracks the opt-in
    /// <see cref="PreferencesService.MasoraMenuEnabled"/> preference — off
    /// unless the user enabled it, so an existing user never sees the entry
    /// appear uninvited after an upgrade.
    /// </summary>
    public bool ShowMasoraEntry => _preferencesService.MasoraMenuEnabled;

    private void OnPreferencesChanged(object? sender, EventArgs e) =>
        OnPropertyChanged(nameof(ShowMasoraEntry));
}
