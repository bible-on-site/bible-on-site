using CommunityToolkit.Mvvm.ComponentModel;
using BibleOnSite.Controls;
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

    /// <summary>
    /// The flyout destination the current page belongs to (#2766). Drives the
    /// per-row <c>Is*Current</c> flags the destination highlight binds to —
    /// on Windows the pinned nav pane always shows it, so the rail works like
    /// the Fluent navigation's selected indicator.
    /// </summary>
    public FlyoutDestination CurrentDestination
    {
        get => _currentDestination;
        set
        {
            if (!SetProperty(ref _currentDestination, value))
            {
                return;
            }

            // Every row flag repaints — the newly selected row and the one
            // that just lost the marker.
            OnPropertyChanged(nameof(IsAlHaperekCurrent));
            OnPropertyChanged(nameof(IsTanahpediaCurrent));
            OnPropertyChanged(nameof(IsLearningCalendarCurrent));
            OnPropertyChanged(nameof(IsMasoraCurrent));
            OnPropertyChanged(nameof(IsParashaCurrent));
            OnPropertyChanged(nameof(IsAuthorsCurrent));
            OnPropertyChanged(nameof(IsDailyBulletinCurrent));
            OnPropertyChanged(nameof(IsTermsCurrent));
            OnPropertyChanged(nameof(IsPreferencesCurrent));
            OnPropertyChanged(nameof(IsContactCurrent));
            OnPropertyChanged(nameof(IsDonationsCurrent));
        }
    }

    private FlyoutDestination _currentDestination;

    public bool IsAlHaperekCurrent => CurrentDestination == FlyoutDestination.AlHaperek;
    public bool IsTanahpediaCurrent => CurrentDestination == FlyoutDestination.Tanahpedia;
    public bool IsLearningCalendarCurrent => CurrentDestination == FlyoutDestination.LearningCalendar;
    public bool IsMasoraCurrent => CurrentDestination == FlyoutDestination.Masora;
    public bool IsParashaCurrent => CurrentDestination == FlyoutDestination.Parasha;
    public bool IsAuthorsCurrent => CurrentDestination == FlyoutDestination.Authors;
    public bool IsDailyBulletinCurrent => CurrentDestination == FlyoutDestination.DailyBulletin;
    public bool IsTermsCurrent => CurrentDestination == FlyoutDestination.Terms;
    public bool IsPreferencesCurrent => CurrentDestination == FlyoutDestination.Preferences;
    public bool IsContactCurrent => CurrentDestination == FlyoutDestination.Contact;
    public bool IsDonationsCurrent => CurrentDestination == FlyoutDestination.Donations;

    /// <summary>
    /// Resolves the destination for a Shell location URI
    /// (<c>CurrentState.Location</c>): the deepest route segment owns the
    /// highlight, so a detail page pushed above a destination keeps that
    /// destination's row selected (#2766).
    /// </summary>
    public static FlyoutDestination DestinationForLocation(string? location)
    {
        var route = location?.Split('?', 2)[0]
            .Split('/', StringSplitOptions.RemoveEmptyEntries)
            .LastOrDefault();
        return DestinationFor(route);
    }

    /// <summary>
    /// Maps a registered Shell route (<see cref="AppRoutes"/>) to its flyout
    /// destination. Detail routes reached inside a destination (Tanahpedia
    /// category/entry, the parasha reader, reader-alias routes) keep their
    /// parent highlighted; routes with no row (articles, unknown) clear it.
    /// </summary>
    public static FlyoutDestination DestinationFor(string? route) =>
        route is not null && RouteDestinations.TryGetValue(route, out var destination)
            ? destination
            : FlyoutDestination.None;

    /// <summary>
    /// Menu/detail destinations plus every reader row derived from the shared
    /// route-role map (<see cref="AppRoutes.ReaderDivisions"/>, #3263) — a new
    /// reader family joins the selection model automatically instead of
    /// needing a second hardcoded reader list here.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, FlyoutDestination> RouteDestinations =
        BuildRouteDestinations();

    private static IReadOnlyDictionary<string, FlyoutDestination> BuildRouteDestinations()
    {
        var map = new Dictionary<string, FlyoutDestination>(StringComparer.Ordinal)
        {
            [AppRoutes.ParashaList] = FlyoutDestination.Parasha,
            [AppRoutes.Tanahpedia] = FlyoutDestination.Tanahpedia,
            [AppRoutes.TanahpediaCategory] = FlyoutDestination.Tanahpedia,
            [AppRoutes.TanahpediaEntryRoute] = FlyoutDestination.Tanahpedia,
            [AppRoutes.LearningCalendar] = FlyoutDestination.LearningCalendar,
            [AppRoutes.Authors] = FlyoutDestination.Authors,
            [AppRoutes.DailyBulletin] = FlyoutDestination.DailyBulletin,
            [AppRoutes.Terms] = FlyoutDestination.Terms,
            [AppRoutes.Preferences] = FlyoutDestination.Preferences,
            [AppRoutes.RecitationPreferences] = FlyoutDestination.Preferences,
            [AppRoutes.DisplayPreferences] = FlyoutDestination.Preferences,
            [AppRoutes.PerekPreferences] = FlyoutDestination.Preferences,
            [AppRoutes.ExtensionPacks] = FlyoutDestination.Preferences,
            [AppRoutes.SoundPreferences] = FlyoutDestination.Preferences,
            [AppRoutes.SupportPreferences] = FlyoutDestination.Preferences,
            [AppRoutes.Contact] = FlyoutDestination.Contact,
            [AppRoutes.Donations] = FlyoutDestination.Donations,
        };
        foreach (var (route, division) in AppRoutes.ReaderDivisions)
        {
            map[route] = division switch
            {
                ReaderDivision.Perek => FlyoutDestination.AlHaperek,
                ReaderDivision.Parasha => FlyoutDestination.Parasha,
                ReaderDivision.Masora => FlyoutDestination.Masora,
                _ => FlyoutDestination.None,
            };
        }
        return map;
    }

    private void OnPreferencesChanged(object? sender, EventArgs e) =>
        OnPropertyChanged(nameof(ShowMasoraEntry));
}
