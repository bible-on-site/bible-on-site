using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.ViewModels;

/// <summary>
/// The פרשה על הפרק section landing: the 54 weekly parashiot grouped by
/// their Torah sefer. Units are positional — the list follows unit id
/// and each entry keeps its own identity (joined pairs are never merged).
/// </summary>
public partial class ParashaListViewModel : ObservableObject //NOSONAR
{
    private readonly ParashaDataService _parashaService;
    private readonly PerekDataService _perekService;
    private readonly IAppNavigator _navigator;

    public ParashaListViewModel() : this(ParashaDataService.Instance, PerekDataService.Instance, ShellAppNavigator.Instance) { }

    public ParashaListViewModel(ParashaDataService parashaService, PerekDataService perekService, IAppNavigator navigator)
    {
        _parashaService = parashaService;
        _perekService = perekService;
        _navigator = navigator;
    }

    [ObservableProperty]
    private List<ParashaSeferGroup> _groups = [];

    [ObservableProperty]
    private bool _isLoading;

    /// <summary>Loads the parasha catalog and groups it by Torah sefer.</summary>
    public async Task LoadAsync()
    {
        if (Groups.Count > 0)
        {
            return;
        }
        IsLoading = true;
        try
        {
            await _perekService.LoadAsync();
            await _parashaService.LoadAsync();
            var units = _parashaService.Parashiot ?? [];

            var groups = new List<ParashaSeferGroup>();
            foreach (var unit in units)
            {
                var seferName = _perekService.GetPerek(unit.TorahRange.StartPerekId)?.SeferName ?? string.Empty;
                if (groups.Count == 0 || groups[^1].SeferName != seferName)
                {
                    groups.Add(new ParashaSeferGroup(seferName));
                }
                groups[^1].Add(unit);
            }
            Groups = groups;
        }
        finally { IsLoading = false; }
    }

    /// <summary>Opens the parasha reader for a unit.</summary>
    [RelayCommand]
    private Task OpenParasha(ParashaUnit unit) =>
        _navigator.GoToAsync($"ParashaPage?unitId={unit.UnitId}");
}

/// <summary>A Torah sefer heading plus its ordered parasha units.</summary>
public sealed class ParashaSeferGroup(string seferName) : List<ParashaUnit>
{
    public string SeferName { get; } = seferName;
}
