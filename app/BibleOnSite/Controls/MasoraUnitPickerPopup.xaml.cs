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

    public MasoraUnitPickerPopup()
    {
        InitializeComponent();
        LoadSeferGroups();
    }

    /// <summary>Shows the picker popup.</summary>
    public void Show()
    {
        IsVisible = true;
    }

    /// <summary>Shows the picker popup, pre-selecting the given unit.</summary>
    public void Show(int currentUnitId)
    {
        IsVisible = true;
        PreSelectUnit(currentUnitId);
    }

    /// <summary>
    /// Hides the picker popup.
    /// </summary>
    public void Hide()
    {
        IsVisible = false;
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
}
