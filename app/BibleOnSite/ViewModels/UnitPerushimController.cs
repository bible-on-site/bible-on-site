using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.ViewModels;

#if MAUI
internal readonly record struct PerushRow(int PerekId, int PasukNum, Pasuk Pasuk);

internal sealed class UnitPerushimController<TUnit> where TUnit : class
{
    private readonly PerushimCatalogService _catalogService;
    private readonly PerushimNotesService _notesService;
    private readonly PreferencesService _preferencesService;
    private readonly IAppNavigator _navigator;
    private readonly IFileSystem _fileSystem;
    private readonly IShare _share;
    private readonly Func<TUnit, List<MasoraUnitText.PerekSlice>> _getSlices;
    private readonly Func<TUnit, int> _getUnitId;
    private readonly Func<TUnit, IEnumerable<PerushRow>> _getRows;
    private readonly Func<TUnit, int, int, bool> _containsPasuk;
    private readonly Func<int> _getCurrentUnitId;
    private readonly Func<List<int>> _getCheckedPerushim;
    private readonly Action<List<int>> _setCheckedPerushim;
    private readonly Func<List<Perush>> _getPerushim;
    private readonly Action<List<Perush>> _setPerushim;
    private readonly Action<bool> _setNotesAvailable;
    private readonly Action<bool> _setNotesPending;
    private readonly Action<bool> _setCatalogAvailable;
    private readonly Action _notifyPerushimStateChanged;
    private readonly Action<TUnit> _fillFilteredPerushContents;

    private readonly Dictionary<int, PerushNoteChapter> _perushChapters = new();

    public UnitPerushimController(
        PerushimCatalogService catalogService,
        PerushimNotesService notesService,
        PreferencesService preferencesService,
        IAppNavigator navigator,
        IFileSystem fileSystem,
        IShare share,
        Func<TUnit, List<MasoraUnitText.PerekSlice>> getSlices,
        Func<TUnit, int> getUnitId,
        Func<int> getCurrentUnitId,
        Func<TUnit, IEnumerable<PerushRow>> getRows,
        Func<TUnit, int, int, bool> containsPasuk,
        Func<List<int>> getCheckedPerushim,
        Action<List<int>> setCheckedPerushim,
        Func<List<Perush>> getPerushim,
        Action<List<Perush>> setPerushim,
        Action<bool> setNotesAvailable,
        Action<bool> setNotesPending,
        Action<bool> setCatalogAvailable,
        Action notifyPerushimStateChanged,
        Action<TUnit> fillFilteredPerushContents)
    {
        _catalogService = catalogService;
        _notesService = notesService;
        _preferencesService = preferencesService;
        _navigator = navigator;
        _fileSystem = fileSystem;
        _share = share;
        _getSlices = getSlices;
        _getUnitId = getUnitId;
        _getCurrentUnitId = getCurrentUnitId;
        _getRows = getRows;
        _containsPasuk = containsPasuk;
        _getCheckedPerushim = getCheckedPerushim;
        _setCheckedPerushim = setCheckedPerushim;
        _getPerushim = getPerushim;
        _setPerushim = setPerushim;
        _setNotesAvailable = setNotesAvailable;
        _setNotesPending = setNotesPending;
        _setCatalogAvailable = setCatalogAvailable;
        _notifyPerushimStateChanged = notifyPerushimStateChanged;
        _fillFilteredPerushContents = fillFilteredPerushContents;
    }

    public int InlineCommentaryLimit => _preferencesService.InlineCommentaryLimit;

    public string InlineCommentaryLimitMessage =>
        $"ניתן להציג עד {InlineCommentaryLimit} פירושים על הפרק. ניתן לשנות בהעדפות.";

    public string PerushimSelectionStatus =>
        $"נבחרו {_getCheckedPerushim().Count} מתוך {InlineCommentaryLimit}";

    public bool PerushimLimitReached => _getCheckedPerushim().Count >= InlineCommentaryLimit;

    public async Task LoadAsync(TUnit unit)
    {
        await _catalogService.InitializeAsync();

        var notesMaterializing = !_notesService.IsInitialized && !_notesService.HasLocalNotesFile;
        if (notesMaterializing)
        {
            _notesService.BeginInitialize();
        }
        else
        {
            await _notesService.InitializeAsync();
        }

        _setCatalogAvailable(_catalogService.IsAvailable);
        _setNotesAvailable(_notesService.IsAvailable);
        _setNotesPending(notesMaterializing && !_notesService.IsAvailable);
        _notifyPerushimStateChanged();

        if (!_notesService.IsAvailable || !_catalogService.IsAvailable)
        {
            ClearPerushim(unit);
            return;
        }

        var slices = _getSlices(unit);
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

        if (_getUnitId(unit) != _getCurrentUnitId())
        {
            return;
        }

        if (allPerushIds.Count == 0)
        {
            ClearPerushim(unit);
            return;
        }

        var allPerushById = await _catalogService.GetPerushimByIdsAsync(allPerushIds);
        if (_getUnitId(unit) != _getCurrentUnitId()) { return; }

        _perushChapters.Clear();
        foreach (var (id, chapter) in chapters) { _perushChapters[id] = chapter; }

        var orderedPerushim = allPerushIds
            .Select(id => allPerushById.GetValueOrDefault(id))
            .Where(perush => perush != null)
            .OrderBy(perush => perush!.Priority)
            .Cast<Perush>()
            .ToList();

        var availableIds = new HashSet<int>(allPerushIds);
        _setCheckedPerushim(_getCheckedPerushim()
            .Where(id => availableIds.Contains(id))
            .Take(InlineCommentaryLimit)
            .ToList());
        _setPerushim(orderedPerushim);
        _fillFilteredPerushContents(unit);
        _notifyPerushimStateChanged();
    }

    public void ToggleCheckedPerush(int perushId, TUnit? currentUnit)
    {
        var list = new List<int>(_getCheckedPerushim());
        if (list.Contains(perushId))
        {
            list.Remove(perushId);
        }
        else
        {
            if (list.Count >= InlineCommentaryLimit) { return; }
            list.Add(perushId);
        }

        _setCheckedPerushim(list);
        if (currentUnit is not null)
        {
            _fillFilteredPerushContents(currentUnit);
        }
    }

    public bool IsPerushChecked(int perushId) => _getCheckedPerushim().Contains(perushId);

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

    public List<PerushNoteDisplay> GetPerushimForRow(TUnit? unit, int perekId, int pasukNum) =>
        unit is not null && _containsPasuk(unit, perekId, pasukNum)
            ? _perushChapters.GetValueOrDefault(perekId)?.GetDisplays(pasukNum, _getPerushim()) ?? new()
            : new();

    public void FillFilteredPerushContents(TUnit unit)
    {
        var rows = _getRows(unit).ToList();
        if (rows.Count == 0) { return; }

        var checkedSet = new HashSet<int>(_getCheckedPerushim());
        if (checkedSet.Count == 0)
        {
            foreach (var row in rows.Where(row => row.Pasuk.PerushNotes.Count > 0))
            {
                row.Pasuk.PerushNotes = new List<PerushNoteDisplay>();
            }
            return;
        }

        foreach (var row in rows)
        {
            var displays = _perushChapters.GetValueOrDefault(row.PerekId)?.GetDisplays(
                row.PasukNum, _getPerushim(), checkedSet, row.Pasuk.PerushNotes) ?? new();
            if (!displays.SequenceEqual(row.Pasuk.PerushNotes)) { row.Pasuk.PerushNotes = displays; }
        }
    }

    private void ClearPerushim(TUnit unit)
    {
        _perushChapters.Clear();
        _setCheckedPerushim(new List<int>());
        _setPerushim(new List<Perush>());
        _fillFilteredPerushContents(unit);
    }

}
#endif
