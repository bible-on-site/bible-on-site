using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.ViewModels;

/// <summary>
/// The מועדים על הפרק section landing: the published catalogue ordered by
/// <see cref="MoedUnit.AnnualOrder"/> and grouped by its Hebrew-month
/// anchor. The catalogue itself comes from the DB-backed API through
/// <see cref="MoedService"/> (or its offline cache) — the app keeps no
/// hardcoded corpus (#3261).
/// </summary>
// Codacy: S2333 false positive — partial is required by the MVVM source
// generators ([ObservableProperty]/[RelayCommand]).
#pragma warning disable S2333
public partial class MoadimListViewModel : ObservableObject //NOSONAR
#pragma warning restore S2333
{
    /// <summary>Header shown for entries the catalogue left without a month anchor.</summary>
    internal const string UngroupedLabel = "ללא חודש";

    private readonly MoedService _moedService;
    private readonly IAppNavigator _navigator;

    public MoadimListViewModel() : this(MoedService.Instance, ShellAppNavigator.Instance) { }

    public MoadimListViewModel(MoedService moedService, IAppNavigator navigator)
    {
        _moedService = moedService;
        _navigator = navigator;
    }

    [ObservableProperty]
    private List<MoedMonthGroup> _groups = [];

    [ObservableProperty]
    private bool _isLoading;

    /// <summary>Whether the catalogue finished loading with no published moadim.</summary>
    [ObservableProperty]
    private bool _isEmpty;

    /// <summary>Loads the catalogue and groups it by Hebrew month, in annual order.</summary>
    public async Task LoadAsync()
    {
        if (Groups.Count > 0)
        {
            return;
        }
        IsLoading = true;
        try
        {
            await _moedService.LoadWithRetryAsync();
            var groups = new List<MoedMonthGroup>();
            var byMonth = new Dictionary<string, MoedMonthGroup>(StringComparer.Ordinal);
            foreach (var moed in _moedService.Moadim)
            {
                var month = string.IsNullOrWhiteSpace(moed.HebrewMonth) ? UngroupedLabel : moed.HebrewMonth;
                if (!byMonth.TryGetValue(month, out var group))
                {
                    group = new MoedMonthGroup(month);
                    byMonth[month] = group;
                    groups.Add(group);
                }
                group.Add(moed);
            }
            Groups = groups;
            IsEmpty = groups.Count == 0;
        }
        finally { IsLoading = false; }
    }

    /// <summary>Opens the moed reader for a catalogue entry.</summary>
    [RelayCommand]
    private async Task OpenMoed(MoedUnit moed)
    {
        try
        {
            await _navigator.GoToAsync($"{AppRoutes.Moed}?slug={Uri.EscapeDataString(moed.Slug)}");
        }
        #pragma warning disable S2221 // Deliberate failure boundary: navigation failure must not crash the caller
        catch (Exception ex) //NOSONAR — navigation failure must not crash the caller.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Moed navigation failed for {moed.Slug}: {ex}");
        }
    }
}

/// <summary>A Hebrew-month heading plus its ordered moadim.</summary>
public sealed class MoedMonthGroup(string monthName) : List<MoedUnit>
{
    public string MonthName { get; } = monthName;
}
