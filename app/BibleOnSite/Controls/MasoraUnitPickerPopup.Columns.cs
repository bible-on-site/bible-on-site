using BibleOnSite.Data;
using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.Controls;

/// <summary>
/// Cascading-column logic half of <see cref="MasoraUnitPickerPopup"/> — the
/// group/sefer/unit column sources, selection chaining, and pre-selection
/// (same split pattern as PerekPage's partial files).
/// </summary>
// Codacy: S2333 false positive — partial is required by the XAML code
// generator and by the xaml.cs partial part.
#pragma warning disable S2333
public partial class MasoraUnitPickerPopup
#pragma warning restore S2333
{
    private SeferGroupItem? _selectedGroup;
    private SeferItem? _selectedSefer;
    private MasoraUnit? _selectedUnit;

    private void LoadSeferGroups()
    {
        var groups = new List<SeferGroupItem>
        {
            new(1, "תורה"),
            new(2, "נביאים"),
            new(3, "כתובים")
        };

        SeferGroupList.ItemsSource = groups;
    }

    private void PreSelectUnit(int unitId)
    {
        var unit = MasoraDataService.Instance.GetUnit(unitId);
        if (unit == null)
        {
            return;
        }

        var seferGroup = SefarimData.GetSeferGroup(unit.SeferId);

        // Select the group
        var groups = (List<SeferGroupItem>)SeferGroupList.ItemsSource;
        var groupItem = groups.FirstOrDefault(g => g.Id == (int)seferGroup);
        if (groupItem != null)
        {
            SeferGroupList.SelectedItem = groupItem;
            _selectedGroup = groupItem;

            // After group is selected, load sefarim and select the right sefer
            MainThread.BeginInvokeOnMainThread(async () =>
            {
                await Task.Delay(50); // Allow UI to update

                var sefarim = (List<SeferItem>?)SeferList.ItemsSource;
                if (sefarim != null)
                {
                    var seferItem = sefarim.FirstOrDefault(s => s.SeferId == unit.SeferId);
                    if (seferItem != null)
                    {
                        SeferList.SelectedItem = seferItem;
                        _selectedSefer = seferItem;

                        await Task.Delay(50); // Allow UI to update

                        var units = (List<MasoraUnit>?)UnitList.ItemsSource;
                        if (units != null)
                        {
                            var unitItem = units.FirstOrDefault(u => u.UnitId == unitId);
                            if (unitItem != null)
                            {
                                UnitList.SelectedItem = unitItem;
                                _selectedUnit = unitItem;
                                UpdateConfirmButtonState();
                            }
                        }
                    }
                }
            });
        }
    }

    private void OnSeferGroupSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.Count == 0)
        {
            return;
        }

        _selectedGroup = e.CurrentSelection[0] as SeferGroupItem;
        _selectedSefer = null;
        _selectedUnit = null;

        if (_selectedGroup == null)
        {
            return;
        }

        LoadSefarimForGroup(_selectedGroup.Id);
        UnitList.ItemsSource = null;

        // Auto-select first sefer
        var sefarim = SeferList.ItemsSource as List<SeferItem>;
        if (sefarim?.Count > 0)
        {
            SeferList.SelectedItem = sefarim[0];
        }

        UpdateConfirmButtonState();
    }

    private void LoadSefarimForGroup(int groupId)
    {
        var units = MasoraDataService.Instance.Units;
        if (units == null)
        {
            SeferList.ItemsSource = new List<SeferItem>();
            return;
        }

        var (from, to) = SefarimData.GetSeferGroupRange(groupId - 1); // 0-based index
        var seen = new HashSet<int>();
        var sefarim = new List<SeferItem>();
        foreach (var unit in units)
        {
            if (unit.SeferId < from || unit.SeferId > to || !seen.Add(unit.SeferId))
            {
                continue;
            }
            sefarim.Add(new SeferItem { SeferId = unit.SeferId, SeferName = unit.SeferName });
        }

        SeferList.ItemsSource = sefarim;
    }

    private void OnSeferSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.Count == 0)
        {
            return;
        }

        _selectedSefer = e.CurrentSelection[0] as SeferItem;
        _selectedUnit = null;

        if (_selectedSefer == null)
        {
            return;
        }

        LoadUnitsForSefer(_selectedSefer.SeferId);

        // Auto-select first unit
        var units = UnitList.ItemsSource as List<MasoraUnit>;
        if (units?.Count > 0)
        {
            UnitList.SelectedItem = units[0];
        }

        UpdateConfirmButtonState();
    }

    private void LoadUnitsForSefer(int seferId)
    {
        var units = MasoraDataService.Instance.Units?
            .Where(u => u.SeferId == seferId)
            .ToList() ?? new List<MasoraUnit>();
        UnitList.ItemsSource = units;
    }

    private void OnUnitSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.Count == 0)
        {
            return;
        }

        _selectedUnit = e.CurrentSelection[0] as MasoraUnit;
        UpdateConfirmButtonState();
    }

    private void UpdateConfirmButtonState()
    {
        ConfirmButton.IsEnabled = _selectedUnit != null;
    }

    /// <summary>A Torah/Neviim/Ketuvim column item.</summary>
    private sealed class SeferGroupItem(int id, string name)
    {
        public int Id { get; } = id;
        public string Name { get; } = name;
    }

    /// <summary>A sefer column item.</summary>
    private sealed class SeferItem
    {
        public int SeferId { get; set; }
        public required string SeferName { get; set; }
    }
}
