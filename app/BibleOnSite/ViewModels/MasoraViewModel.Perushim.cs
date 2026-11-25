using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.ViewModels;

// Codacy: S2333 false positive — partial is required by the MVVM source
// generators and the main partial part.
#pragma warning disable S2333
public partial class MasoraViewModel //NOSONAR
#pragma warning restore S2333
{
#if MAUI
    private UnitPerushimController<MasoraUnit> _perushimController = null!;

    private void InitializePerushimController()
    {
        _perushimController = new UnitPerushimController<MasoraUnit>(
            _catalogService, _notesService, _preferencesService, _navigator, _fileSystem, _share,
            MasoraUnitText.PerekSlicesForUnit,
            unit => unit.UnitId,
            () => Unit?.UnitId ?? 0,
            unit => unit.Rows.Select(row => new PerushRow(row.PerekId, row.PasukNum, row.Pasuk)),
            (unit, perekId, pasukNum) => unit.Rows.Any(row => row.PerekId == perekId && row.PasukNum == pasukNum),
            () => CheckedPerushim, value => CheckedPerushim = value,
            () => Perushim, value => Perushim = value,
            value => PerushimNotesAvailable = value,
            value => PerushimNotesPending = value,
            value => PerushimCatalogAvailable = value,
            NotifyPerushimStateChanged,
            FillFilteredPerushContents);
    }

    private void NotifyPerushimStateChanged()
    {
        OnPropertyChanged(nameof(PerushimEmptyMessage));
        OnPropertyChanged(nameof(ShowDownloadPerushimButton));
    }

    private void FillFilteredPerushContents(MasoraUnit unit) =>
        _perushimController.FillFilteredPerushContents(unit);

    public Task LoadPerushimAsync(MasoraUnit unit) => _perushimController.LoadAsync(unit);

    public string InlineCommentaryLimitMessage => _perushimController.InlineCommentaryLimitMessage;
    public int InlineCommentaryLimit => _perushimController.InlineCommentaryLimit;
    public string PerushimSelectionStatus => _perushimController.PerushimSelectionStatus;
    public bool PerushimLimitReached => _perushimController.PerushimLimitReached;

    [RelayCommand]
    public void ToggleCheckedPerush(int perushId) =>
        _perushimController.ToggleCheckedPerush(perushId, Unit);

    public bool IsPerushChecked(int perushId) => _perushimController.IsPerushChecked(perushId);

    [RelayCommand]
    public Task ExportPerushimLogsAsync() => _perushimController.ExportPerushimLogsAsync();

    public List<PerushNoteDisplay> GetPerushimForRow(int perekId, int pasukNum) =>
        _perushimController.GetPerushimForRow(Unit, perekId, pasukNum);
#endif
}
