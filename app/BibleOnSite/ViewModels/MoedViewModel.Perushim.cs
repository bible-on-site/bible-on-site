using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.ViewModels;

/// <summary>
/// Perushim half of <see cref="MoedViewModel"/> — commentary catalog/notes
/// loading and the checked-perush inline filter, scoped to the moed's whole
/// section/range union (same pipeline as <see cref="MasoraViewModel"/>,
/// whose commentary notes attach by canonical (perekId, pasuk)).
/// </summary>
// Codacy: S2333 false positive — partial is required by the MVVM source
// generators and the main partial part.
#pragma warning disable S2333
public partial class MoedViewModel //NOSONAR
#pragma warning restore S2333
{
#if MAUI
    /// <summary>Loaded notes for the current moed, keyed on read — never re-created.</summary>
    private readonly Dictionary<int, PerushNoteChapter> _perushChapters = new();

    /// <summary>
    /// Loads perushim (commentaries) for the current moed — the union of the
    /// catalog/notes available across every perek the moed's sections cover,
    /// with each note filtered to the pasuk bounds the ranges actually read.
    /// Previously checked perushim that remain available stay checked.
    /// </summary>
    public async Task LoadPerushimAsync(MoedUnit moed)
    {
        await _catalogService.InitializeAsync();

        // With no local notes DB, InitializeAsync materializes the delivered
        // pack first — a copy of hundreds of MB inside the service lock.
        // Awaiting it on the reader path starved the UI thread past the e2e
        // startup deadline (#2430), so kick it instead; the page's
        // operation-completed hook reloads perushim once the copy lands.
        var notesMaterializing = !_notesService.IsInitialized && !_notesService.HasLocalNotesFile;
        if (notesMaterializing)
        {
            _notesService.BeginInitialize();
        }
        else
        {
            await _notesService.InitializeAsync();
        }

        PerushimCatalogAvailable = _catalogService.IsAvailable;
        PerushimNotesAvailable = _notesService.IsAvailable;
        PerushimNotesPending = notesMaterializing && !PerushimNotesAvailable;
        OnPropertyChanged(nameof(PerushimEmptyMessage));
        OnPropertyChanged(nameof(ShowDownloadPerushimButton));

        if (!PerushimNotesAvailable || !PerushimCatalogAvailable)
        {
            _perushChapters.Clear();
            // Set CheckedPerushim BEFORE Perushim so the CollectionView sees correct state
            CheckedPerushim = new List<int>();
            Perushim = new List<Perush>();
            FillFilteredPerushContents(moed);
            return;
        }

        var slices = MoedUnitText.PerekSlicesForUnit(moed);

        // Load each distinct perek once, overlapped — sections and ranges can
        // repeat a perek (מפטיר repeats the Torah ending), and serial awaits
        // made the navigation cost the sum of every chapter load.
        var chapterTasks = slices
            .Select(slice => slice.PerekId)
            .Distinct()
            .ToDictionary(perekId => perekId, _notesService.LoadChapterAsync);
        await Task.WhenAll(chapterTasks.Values);
        var chapters = new Dictionary<int, PerushNoteChapter>();
        foreach (var (perekId, task) in chapterTasks)
        {
            if (task.Result is { } chapter) { chapters[perekId] = chapter; }
        }

        var allPerushIds = new List<int>();
        var seenIds = new HashSet<int>();
        foreach (var slice in slices)
        {
            if (!chapters.TryGetValue(slice.PerekId, out var chapter)) { continue; }
            foreach (var id in chapter.AvailablePerushIds(slice.StartPasuk, slice.EndPasuk).Where(seenIds.Add))
            {
                allPerushIds.Add(id);
            }
        }

        if (Unit?.Id != moed.Id)
        {
            return; // Stale load — a newer moed is already on screen.
        }

        if (allPerushIds.Count == 0)
        {
            _perushChapters.Clear();
            CheckedPerushim = new List<int>();
            Perushim = new List<Perush>();
            FillFilteredPerushContents(moed);
            return;
        }

        var allPerushById = await _catalogService.GetPerushimByIdsAsync(allPerushIds);
        if (Unit?.Id != moed.Id) { return; }
        _perushChapters.Clear();
        foreach (var (id, chapter) in chapters) { _perushChapters[id] = chapter; }
        var orderedPerushim = allPerushIds
            .Select(id => allPerushById.GetValueOrDefault(id))
            .Where(p => p != null)
            .OrderBy(p => p!.Priority)
            .Cast<Perush>()
            .ToList();

        // Preserve checked perushim that are also available in the new moed.
        var availableIds = new HashSet<int>(allPerushIds);
        CheckedPerushim = CheckedPerushim.Where(id => availableIds.Contains(id)).Take(_preferencesService.InlineCommentaryLimit).ToList();
        Perushim = orderedPerushim;

        FillFilteredPerushContents(moed);
        OnPropertyChanged(nameof(PerushimEmptyMessage));
        OnPropertyChanged(nameof(ShowDownloadPerushimButton));
    }

    public string InlineCommentaryLimitMessage => $"ניתן להציג עד {_preferencesService.InlineCommentaryLimit} פירושים על הפרק. ניתן לשנות בהעדפות.";

    /// <summary>Max perushim shown inline — unchecked rows render disabled at the cap.</summary>
    public int InlineCommentaryLimit => _preferencesService.InlineCommentaryLimit;

    /// <summary>Live "נבחרו N מתוך M" counter for the perushim selector header.</summary>
    public string PerushimSelectionStatus => $"נבחרו {CheckedPerushim.Count} מתוך {InlineCommentaryLimit}";

    /// <summary>Whether the configured perushim limit is fully used (drives subtle max-reached emphasis).</summary>
    public bool PerushimLimitReached => CheckedPerushim.Count >= InlineCommentaryLimit;

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
            if (list.Count >= _preferencesService.InlineCommentaryLimit) { return; }
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
    /// Exports perushim diagnostics to a file and opens the share sheet for support.
    /// </summary>
    [RelayCommand]
    public async Task ExportPerushimLogsAsync()
    {
        try
        {
            var report = await _notesService.GetDiagnosticsAsync();
            var fileName = $"perushim_diagnostics_{DateTime.UtcNow:yyyyMMdd_HHmmss}.txt";
            var path = Path.Join(_fileSystem.CacheDirectory, fileName);
            await File.WriteAllTextAsync(path, report);
            await _share.RequestAsync(new ShareFileRequest
            {
                Title = "ייצוא לוגים - פירושים",
                File = new ShareFile(path),
            });
        }
        #pragma warning disable S2221 // Deliberate failure boundary: log export failure alerts the user
        catch (Exception ex) //NOSONAR — log export failure alerts the user.
        {
            #pragma warning restore S2221
            System.Diagnostics.Debug.WriteLine($"Export perushim logs failed: {ex.Message}");
            await _navigator.DisplayAlertAsync("שגיאה", $"לא ניתן לייצא לוגים: {ex.Message}", "אישור");
        }
    }

    /// <summary>
    /// All available commentary for a row, independent of inline filters —
    /// notes attach by (perekId, pasuk) so a pasuk repeated across sections
    /// or a range spanning perakim stays precise.
    /// </summary>
    public List<PerushNoteDisplay> GetPerushimForRow(int perekId, int pasukNum) =>
        Rows.Any(row => row.PerekId == perekId && row.PasukNum == pasukNum)
            ? _perushChapters.GetValueOrDefault(perekId)?.GetDisplays(pasukNum, Perushim) ?? new()
            : new();

    /// <summary>
    /// Fills each row's PerushNotes based on checked perushim — keyed by
    /// (perekId, pasuk) so identical pasuk numbers in different perakim or
    /// repeated across sections keep their own notes.
    /// </summary>
    private void FillFilteredPerushContents(MoedUnit moed)
    {
        if (moed.Rows.Count == 0)
        {
            return;
        }

        var checkedSet = new HashSet<int>(CheckedPerushim);
        if (checkedSet.Count == 0)
        {
            foreach (var pasuk in moed.Rows.Select(row => row.Pasuk)
                .Where(pasuk => pasuk is { PerushNotes.Count: > 0 }))
            {
                pasuk!.PerushNotes = new List<PerushNoteDisplay>();
            }
            return;
        }

        foreach (var row in moed.Rows)
        {
            if (row.Pasuk is not { } pasuk)
            {
                continue;
            }
            var displays = _perushChapters.GetValueOrDefault(row.PerekId)?.GetDisplays(
                row.PasukNum, Perushim, checkedSet, pasuk.PerushNotes) ?? new();
            if (!displays.SequenceEqual(pasuk.PerushNotes)) { pasuk.PerushNotes = displays; }
        }
    }
#endif
}
