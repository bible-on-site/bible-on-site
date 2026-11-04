using BibleOnSite.Models;

namespace BibleOnSite.Controls;

/// <summary>
/// A popup control for selecting a Masoretic unit using a 3-column cascading
/// picker — the unit-level counterpart of <see cref="PerekPickerPopup"/>.
/// Column 1: Sefer group (Torah, Neviim, Ketuvim)
/// Column 2: Sefer within the group (only sefarim that have masora units)
/// Column 3: Unit within the sefer (its scripture-reference heading)
/// </summary>
// Codacy: S2333 false positive — partial is required by the XAML code
// generator and by the Columns partial part.
#pragma warning disable S2333
public partial class MasoraUnitPickerPopup : ContentView //NOSONAR
#pragma warning restore S2333
{
    /// <summary>
    /// Event raised when a unit is selected and confirmed. Codacy's S3264
    /// per-file analysis cannot see the subscribers in MasoraPage's code-behind
    /// (same false-positive pattern as Perek.cs's PropertyChanged pragma).
    /// </summary>
#pragma warning disable S3264 // Events should be invoked
    public event EventHandler<int>? UnitSelected; //NOSONAR
#pragma warning restore S3264

    // Per-column boundary arrows — shared with the perek and parasha pickers
    // through PickerScrollColumns (#2573).
    private readonly PickerScrollColumns _scrollColumns;

    public MasoraUnitPickerPopup()
    {
        InitializeComponent();
        _scrollColumns = new PickerScrollColumns(Dispatcher,
            new PickerScrollColumn(SeferGroupList, SeferGroupUpArrow, SeferGroupDownArrow, SeferGroupItemSizer),
            new PickerScrollColumn(SeferList, SeferUpArrow, SeferDownArrow, SeferItemSizer),
            new PickerScrollColumn(UnitList, UnitUpArrow, UnitDownArrow, UnitItemSizer));
        LoadSeferGroups();
    }

    /// <summary>Shows the picker popup.</summary>
    public void Show()
    {
        IsVisible = true;
        _scrollColumns.RefreshAllDeferred();
    }

    /// <summary>Shows the picker popup, pre-selecting the given unit.</summary>
    public void Show(int currentUnitId)
    {
        IsVisible = true;
        PreSelectUnit(currentUnitId);
        _scrollColumns.RefreshAllDeferred();
    }

    /// <summary>
    /// Hides the picker popup.
    /// </summary>
    public void Hide()
    {
        IsVisible = false;
    }

    private void OnColumnScrolled(object? sender, ItemsViewScrolledEventArgs e) =>
        _scrollColumns.HandleScrolled(sender, e.FirstVisibleItemIndex, e.LastVisibleItemIndex);

    private void OnColumnSizeChanged(object? sender, EventArgs e) =>
        _scrollColumns.HandleSizeChanged(sender);

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
