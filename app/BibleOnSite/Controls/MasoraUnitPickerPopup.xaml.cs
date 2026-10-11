using BibleOnSite.Data;
using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.Controls;

/// <summary>
/// A popup control for selecting a Masoretic unit using a 3-column cascading
/// picker — the unit-level counterpart of <see cref="PerekPickerPopup"/>.
/// Column 1: Sefer group (Torah, Neviim, Ketuvim)
/// Column 2: Sefer within the group (only sefarim that have masora units)
/// Column 3: Unit within the sefer (its scripture-reference heading)
/// </summary>
public partial class MasoraUnitPickerPopup : ContentView
{
    private SeferGroupItem? _selectedGroup;
    private SeferItem? _selectedSefer;
    private MasoraUnit? _selectedUnit;

    /// <summary>
    /// Event raised when a unit is selected and confirmed.
    /// </summary>
    public event EventHandler<int>? UnitSelected;

    /// <summary>
    /// Event raised when the popup is dismissed.
    /// </summary>
    public event EventHandler? Dismissed;

    public MasoraUnitPickerPopup()
    {
        InitializeComponent();
        LoadSeferGroups();
    }

    /// <summary>
    /// Shows the picker popup.
    /// </summary>
    /// <param name="currentUnitId">Optional current unit id to pre-select.</param>
    public void Show(int? currentUnitId = null)
    {
        IsVisible = true;

        if (currentUnitId.HasValue)
        {
            PreSelectUnit(currentUnitId.Value);
        }
    }

    /// <summary>
    /// Hides the picker popup.
    /// </summary>
    public void Hide()
    {
        IsVisible = false;
        Dismissed?.Invoke(this, EventArgs.Empty);
    }

    private void LoadSeferGroups()
    {
        var groups = new List<SeferGroupItem>
        {
            new() { Id = 1, Name = "תורה" },
            new() { Id = 2, Name = "נביאים" },
            new() { Id = 3, Name = "כתובים" }
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

    private void OnBackgroundTapped(object? sender, TappedEventArgs e)
    {
        Hide();
    }

    private void OnCancelClicked(object? sender, EventArgs e)
    {
        Hide();
    }

    private void OnConfirmClicked(object? sender, EventArgs e)
    {
        if (_selectedUnit != null)
        {
            UnitSelected?.Invoke(this, _selectedUnit.UnitId);
            Hide();
        }
    }

    #region Item Classes

    private class SeferGroupItem
    {
        public int Id { get; set; }
        public required string Name { get; set; }
    }

    private class SeferItem
    {
        public int SeferId { get; set; }
        public required string SeferName { get; set; }
    }

    #endregion
}
