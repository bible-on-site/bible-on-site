using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.ViewModels;

/// <summary>
/// Perushim half of <see cref="MasoraViewModel"/> — commentary catalog/notes
/// loading and the checked-perush inline filter. Split from the main file for
/// readability (same pattern as PerekPage's partial files).
/// </summary>
// Codacy: S2333 false positive — partial is required by the MVVM source
// generators and the main partial part.
#pragma warning disable S2333
public partial class MasoraViewModel //NOSONAR
#pragma warning restore S2333
{
#if MAUI
    /// <summary>Loaded notes for the current unit, keyed on read — never re-created.</summary>
    private readonly List<PerekPerushNote> _perushNotesCache = new();

    /// <summary>
    /// Loads perushim (commentaries) for the current unit — the union of the
    /// catalog/notes available across the unit's overlapping perakim, with
    /// each note filtered to the pasuk bounds the unit actually covers.
    /// Previously checked perushim that remain available stay checked.
    /// </summary>
    public async Task LoadPerushimAsync(MasoraUnit unit)
    {
        await _catalogService.InitializeAsync();
        await _notesService.InitializeAsync();

        PerushimCatalogAvailable = _catalogService.IsAvailable;
        PerushimNotesAvailable = _notesService.IsAvailable;
        OnPropertyChanged(nameof(PerushimEmptyMessage));
        OnPropertyChanged(nameof(ShowDownloadPerushimButton));

        if (!PerushimNotesAvailable || !PerushimCatalogAvailable)
        {
            _perushNotesCache.Clear();
            // Set CheckedPerushim BEFORE Perushim so the CollectionView sees correct state
            CheckedPerushim = new List<int>();
            Perushim = new List<Perush>();
            FillFilteredPerushContents(unit);
            return;
        }

        var slices = MasoraUnitText.PerekSlicesForUnit(unit);
        var allPerushIds = new List<int>();
        var seenIds = new HashSet<int>();
        var notes = new List<PerekPerushNote>();
        foreach (var slice in slices)
        {
            var perushIds = await _notesService.GetPerushIdsForPerekAsync(slice.PerekId);
            foreach (var id in perushIds)
            {
                if (seenIds.Add(id))
                {
                    allPerushIds.Add(id);
                }
            }
            if (perushIds.Count > 0)
            {
                var perushById = await _catalogService.GetPerushimByIdsAsync(perushIds);
                var sliceNotes = await _notesService.LoadNotesForPerekAsync(slice.PerekId, perushById);
                // Verse-addressed notes attach to whole pesukim — keep only the
                // notes inside the unit's covered pasuk bounds for this perek.
                notes.AddRange(sliceNotes.Where(n =>
                    n.Pasuk >= slice.StartPasuk && n.Pasuk <= slice.EndPasuk));
            }
        }

        if (Unit?.UnitId != unit.UnitId)
        {
            return; // Stale load — a newer unit is already on screen.
        }

        if (allPerushIds.Count == 0)
        {
            _perushNotesCache.Clear();
            CheckedPerushim = new List<int>();
            Perushim = new List<Perush>();
            FillFilteredPerushContents(unit);
            return;
        }

        _perushNotesCache.Clear();
        _perushNotesCache.AddRange(notes);

        var allPerushById = await _catalogService.GetPerushimByIdsAsync(allPerushIds);
        var orderedPerushim = allPerushIds
            .Select(id => allPerushById.GetValueOrDefault(id))
            .Where(p => p != null)
            .OrderBy(p => p!.Priority)
            .Cast<Perush>()
            .ToList();

        // Preserve checked perushim that are also available in the new unit.
        var availableIds = new HashSet<int>(allPerushIds);
        CheckedPerushim = CheckedPerushim.Where(id => availableIds.Contains(id)).ToList();
        Perushim = orderedPerushim;

        FillFilteredPerushContents(unit);
        OnPropertyChanged(nameof(PerushimEmptyMessage));
        OnPropertyChanged(nameof(ShowDownloadPerushimButton));
    }

    /// <summary>Toggles commentary in the inline reader.</summary>
    [RelayCommand]
    public void ToggleCheckedPerush(int perushId)
    {
        var list = new List<int>(CheckedPerushim);
        if (list.Contains(perushId))
        {
            list.Remove(perushId);
        }
        else
        {
            list.Add(perushId);
        }
        CheckedPerushim = list;
        if (Unit != null)
        {
            FillFilteredPerushContents(Unit);
        }
    }

    /// <summary>Returns whether a perush is currently checked.</summary>
    public bool IsPerushChecked(int perushId) => CheckedPerushim.Contains(perushId);

    /// <summary>
    /// All available commentary for a row, independent of inline filters —
    /// notes attach by (perekId, pasuk) so multi-perek units stay precise.
    /// </summary>
    public List<PerushNoteDisplay> GetPerushimForRow(int perekId, int pasukNum) => _perushNotesCache
        .Where(n => n.PerekId == perekId && n.Pasuk == pasukNum)
        .GroupBy(n => (n.PerushId, n.PerushName))
        .OrderBy(g => Perushim.FindIndex(p => p.Id == g.Key.PerushId))
        .Select(g => new PerushNoteDisplay
        {
            PerushName = g.Key.PerushName,
            NoteContents = g.OrderBy(n => n.NoteIdx).Select(n => n.NoteContent).ToList()
        }).ToList();

    /// <summary>
    /// Fills each row's PerushNotes based on checked perushim — keyed by
    /// (perekId, pasuk) so identical pasuk numbers in different perakim
    /// inside one unit keep their own notes.
    /// </summary>
    private void FillFilteredPerushContents(MasoraUnit unit)
    {
        if (unit.Rows.Count == 0)
        {
            return;
        }

        var checkedSet = new HashSet<int>(CheckedPerushim);
        if (checkedSet.Count == 0)
        {
            foreach (var row in unit.Rows)
            {
                if (row.Pasuk.PerushNotes.Count > 0)
                {
                    row.Pasuk.PerushNotes = new List<PerushNoteDisplay>();
                }
            }
            return;
        }

        var byKey = _perushNotesCache
            .Where(n => checkedSet.Contains(n.PerushId))
            .GroupBy(n => (n.PerekId, n.Pasuk))
            .ToDictionary(g => g.Key, g => g.ToList());

        var priorityOrder = Perushim.Select((p, i) => (p.Id, i)).ToDictionary(x => x.Id, x => x.i);

        foreach (var row in unit.Rows)
        {
            var notesForPasuk = byKey.GetValueOrDefault((row.PerekId, row.PasukNum))
                ?? new List<PerekPerushNote>();
            var groups = notesForPasuk
                .GroupBy(n => (n.PerushId, n.PerushName))
                .OrderBy(g => priorityOrder.GetValueOrDefault(g.Key.PerushId, 999))
                .Select(g => new PerushNoteDisplay
                {
                    PerushName = g.Key.PerushName,
                    NoteContents = g.OrderBy(n => n.NoteIdx).Select(n => n.NoteContent).ToList()
                })
                .ToList();
            if (groups.Count > 0 || row.Pasuk.PerushNotes.Count > 0)
            {
                row.Pasuk.PerushNotes = groups;
            }
        }
    }
#endif
}
