using BibleOnSite.Models;
using SQLite;
using System.Collections.Concurrent;

namespace BibleOnSite.Services;

/// <summary>
/// Loads the Masoretic (מסורה על הפרק) reading units from the packaged
/// tanah_view SQLite database — the app-side mirror of the website's
/// masora-units module over the shared reading-unit contract. Units map
/// canonical ranges: {perekId, pasuk, segmentIndex?} →
/// {perekId, pasuk, segmentIndex?}, with perekId being the global
/// canonical perek id (1-929), never the displayed chapter number.
/// The data is read-only; scripture itself lives in tanah_pasuk_segment.
/// </summary>
public class MasoraDataService
{
    private static readonly Lazy<MasoraDataService> _instance = new(() => new MasoraDataService());
    public static MasoraDataService Instance => _instance.Value;

    /// <summary>The shared contract's division id (docs/data/reading-units.md).</summary>
    internal const string DivisionId = "masora";

    private List<MasoraUnit>? _units;
    private Dictionary<int, MasoraUnit>? _unitById;
    private bool _isLoaded;
    private bool _isAvailable;
    private readonly SemaphoreSlim _loadLock = new(1, 1);
    private readonly LocalDatabaseService _databaseService;

    private MasoraDataService() : this(LocalDatabaseService.Instance) { }

    public MasoraDataService(LocalDatabaseService databaseService)
    {
        _databaseService = databaseService;
    }

    public bool IsLoaded => _isLoaded;

    /// <summary>Whether the packaged database actually ships Masora reading units.</summary>
    public bool IsAvailable => _isLoaded && _isAvailable;

    public IReadOnlyList<MasoraUnit>? Units => _units;

    public int UnitCount => _units?.Count ?? 0;

    /// <summary>Must be awaited before reading units; safe to call repeatedly.</summary>
    public async Task LoadAsync()
    {
        if (_isLoaded)
        {
            return;
        }
        await _loadLock.WaitAsync();
        try
        {
            if (_isLoaded)
            {
                return;
            }
            var db = await _databaseService.GetDatabaseAsync();
            await LoadUnitsAsync(db);
            _isLoaded = true;
        }
        finally
        {
            _loadLock.Release();
        }
    }

    private async Task LoadUnitsAsync(SQLiteAsyncConnection db)
    {
        List<MasoraUnitDbRow> rows;
        try
        {
            rows = await db.QueryAsync<MasoraUnitDbRow>(
            "SELECT u.unit_id, u.slug, u.sefer_id, u.unit_order, u.heading, u.closing_break, " +
            "s.name AS sefer_name, " +
            "r.range_index, r.start_perek_id, r.start_pasuk, r.start_segment_index, " +
            "r.end_perek_id, r.end_pasuk, r.end_segment_index " +
            "FROM tanah_reading_unit u " +
            "JOIN tanah_reading_unit_range r " +
            "ON r.division_id = u.division_id AND r.unit_id = u.unit_id " +
            "JOIN tanah_sefer s ON s.id = u.sefer_id " +
            "WHERE u.division_id = '" + DivisionId + "' AND r.auxiliary_ordinal IS NULL " +
            "ORDER BY u.unit_id, r.range_index");
        }
        catch (SQLiteException ex)
        {
            // A packaged database predating the reading-unit tables (or a
            // corrupt install) must not crash the reader — the page shows
            // its unavailable empty state instead.
            Console.Error.WriteLine($"[Masora] reading-unit tables unavailable: {ex.Message}");
            _units = new List<MasoraUnit>();
            _unitById = new Dictionary<int, MasoraUnit>();
            _isAvailable = false;
            return;
        }

        var units = new List<MasoraUnit>();
        var unitById = new Dictionary<int, MasoraUnit>();
        foreach (var row in rows)
        {
            if (!unitById.TryGetValue(row.UnitId, out var unit))
            {
                unit = new MasoraUnit
                {
                    UnitId = row.UnitId,
                    Slug = row.Slug,
                    SeferId = row.SeferId,
                    SeferName = row.SeferName ?? string.Empty,
                    UnitOrder = row.UnitOrder,
                    Heading = row.Heading,
                    ClosingBreak = row.ClosingBreak
                };
                unitById[row.UnitId] = unit;
                units.Add(unit);
            }
            unit.Ranges.Add(new MasoraUnitRange
            {
                StartPerekId = row.StartPerekId,
                StartPasuk = row.StartPasuk,
                StartSegmentIndex = row.StartSegmentIndex,
                EndPerekId = row.EndPerekId,
                EndPasuk = row.EndPasuk,
                EndSegmentIndex = row.EndSegmentIndex
            });
        }

        _units = units;
        _unitById = unitById;
        _isAvailable = units.Count > 0;
    }

    /// <summary>A unit by its stable id (today also its slug: "42").</summary>
    public MasoraUnit? GetUnit(int unitId)
    {
        if (_unitById == null)
        {
            return null;
        }
        _unitById.TryGetValue(unitId, out var unit);
        return unit;
    }

    /// <summary>The first unit of each sefer in canonical order (unit_order = 1).</summary>
    public List<MasoraUnit> GetFirstUnitsBySefer()
    {
        if (_units == null)
        {
            return new List<MasoraUnit>();
        }
        return _units.Where(u => u.UnitOrder == 1).ToList();
    }

    /// <summary>Adjacent units by canonical order, for prev/next navigation.</summary>
    public (MasoraUnit? Prev, MasoraUnit? Next) GetAdjacentUnits(int unitId)
    {
        if (_units == null || _units.Count == 0)
        {
            return (null, null);
        }
        var index = _units.FindIndex(u => u.UnitId == unitId);
        if (index < 0)
        {
            return (null, null);
        }
        var prev = index > 0 ? _units[index - 1] : null;
        var next = index < _units.Count - 1 ? _units[index + 1] : null;
        return (prev, next);
    }

    /// <summary>
    /// The unit whose primary range contains the given perek's first pasuk —
    /// used to position the reader when opening from the per-perek resume point.
    /// </summary>
    public MasoraUnit? GetUnitContainingPasuk(int perekId) => GetUnitContainingPasuk(perekId, 1);

    /// <summary>
    /// The unit whose primary range contains the given canonical pasuk.
    /// </summary>
    public MasoraUnit? GetUnitContainingPasuk(int perekId, int pasuk)
    {
        if (_units == null)
        {
            return null;
        }
        return _units.FirstOrDefault(u =>
            u.Ranges.Any(range => RangeContainsPasuk(range, perekId, pasuk)));
    }

    /// <summary>
    /// Pasuk-level containment (the app's commentary granularity): a pasuk
    /// counts as contained when its start or the range bound intersects it.
    /// Mirrors rangeContainsCoordinate with a whole-pasuk coordinate.
    /// </summary>
    internal static bool RangeContainsPasuk(MasoraUnitRange range, int perekId, int pasuk)
    {
        const int segment = 0;
        var afterStart = perekId > range.StartPerekId
            || (perekId == range.StartPerekId
                && (pasuk > range.StartPasuk
                    || (pasuk == range.StartPasuk && segment >= (range.StartSegmentIndex ?? 0))));
        var beforeEnd = perekId < range.EndPerekId
            || (perekId == range.EndPerekId
                && (pasuk < range.EndPasuk
                    || (pasuk == range.EndPasuk && segment <= (range.EndSegmentIndex ?? int.MaxValue))));
        return afterStart && beforeEnd;
    }

    private class MasoraUnitDbRow
    {
        [Column("unit_id")]
        public int UnitId { get; set; }

        [Column("slug")]
        public string Slug { get; set; } = string.Empty;

        [Column("sefer_id")]
        public int SeferId { get; set; }

        [Column("sefer_name")]
        public string? SeferName { get; set; }

        [Column("unit_order")]
        public int UnitOrder { get; set; }

        [Column("heading")]
        public string Heading { get; set; } = string.Empty;

        [Column("closing_break")]
        public string? ClosingBreak { get; set; }

        [Column("range_index")]
        public int RangeIndex { get; set; }

        [Column("start_perek_id")]
        public int StartPerekId { get; set; }

        [Column("start_pasuk")]
        public int StartPasuk { get; set; }

        [Column("start_segment_index")]
        public int? StartSegmentIndex { get; set; }

        [Column("end_perek_id")]
        public int EndPerekId { get; set; }

        [Column("end_pasuk")]
        public int EndPasuk { get; set; }

        [Column("end_segment_index")]
        public int? EndSegmentIndex { get; set; }
    }
}
