using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.Controls;

/// <summary>
/// A popup control for selecting a פרשה על הפרק unit using a 2-column
/// cascading picker — the parasha counterpart of
/// <see cref="MasoraUnitPickerPopup"/>. Column 1 lists the Torah sefarim
/// that have parasha units; column 2 lists each sefer's parashot in
/// canonical order. The picked unit keeps its stable parasha identity.
/// </summary>
// Codacy: S2333 false positive — partial is required by the XAML code
// generator.
#pragma warning disable S2333
public partial class ParashaUnitPickerPopup : ContentView //NOSONAR
#pragma warning restore S2333
{
    /// <summary>
    /// Event raised when a unit is selected and confirmed. Codacy's S3264
    /// per-file analysis cannot see the subscribers in ParashaPage's code-behind.
    /// </summary>
#pragma warning disable S3264 // Events should be invoked
    public event EventHandler<int>? UnitSelected; //NOSONAR
#pragma warning restore S3264

    private List<ParashaUnit> _sefarim = [];
    private List<ParashaUnit> _unitsInSefer = [];
    private ParashaUnit? _selectedUnit;

    public ParashaUnitPickerPopup()
    {
        InitializeComponent();
    }

    /// <summary>Shows the picker popup.</summary>
    public void Show()
    {
        LoadSefarim();
        IsVisible = true;
    }

    /// <summary>Shows the picker popup, pre-selecting the given unit.</summary>
    public void Show(int currentUnitId)
    {
        LoadSefarim();
        IsVisible = true;
        PreSelectUnit(currentUnitId);
    }

    /// <summary>Hides the picker popup.</summary>
    public void Hide()
    {
        IsVisible = false;
    }

    /// <summary>One row per sefer — the first unit of each sefer carries its name.</summary>
    private void LoadSefarim()
    {
        var parashiot = ParashaDataService.Instance.Parashiot;
        _sefarim = parashiot == null
            ? []
            : parashiot.GroupBy(unit => unit.SeferId).Select(g => g.First()).ToList();
        SeferList.ItemsSource = _sefarim;
    }

    private void OnSeferSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.FirstOrDefault() is not ParashaUnit sefer)
        {
            return;
        }

        _unitsInSefer = ParashaDataService.Instance.Parashiot?
            .Where(unit => unit.SeferId == sefer.SeferId).ToList() ?? [];
        UnitList.ItemsSource = _unitsInSefer;
    }

    private void OnUnitSelected(object? sender, SelectionChangedEventArgs e)
    {
        _selectedUnit = e.CurrentSelection.FirstOrDefault() as ParashaUnit;
        ConfirmButton.IsEnabled = _selectedUnit != null;
    }

    /// <summary>Pre-selects the sefer + unit of the currently displayed parasha.</summary>
    private void PreSelectUnit(int currentUnitId)
    {
        var unit = ParashaDataService.Instance.Parashiot?
            .FirstOrDefault(u => u.UnitId == currentUnitId);
        if (unit == null)
        {
            return;
        }

        var sefer = _sefarim.FirstOrDefault(s => s.SeferId == unit.SeferId);
        if (sefer != null)
        {
            SeferList.SelectedItem = sefer;
            SeferList.ScrollTo(sefer, position: ScrollToPosition.Center, animate: false);
        }
        UnitList.SelectedItem = _unitsInSefer.FirstOrDefault(u => u.UnitId == currentUnitId);
        if (UnitList.SelectedItem != null)
        {
            UnitList.ScrollTo(UnitList.SelectedItem, position: ScrollToPosition.Center, animate: false);
        }
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
