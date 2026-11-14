using BibleOnSite.Models;
using SQLite;

namespace BibleOnSite.Services;

/// <summary>
/// Loads פרשה על הפרק reading units from the shared contract tables
/// (<c>tanah_reading_unit</c> / <c>tanah_reading_unit_range</c>,
/// division <c>parasha</c>) exported by the tanah-view pipeline.
/// Haftarah variants stay ordered auxiliary readings — see
/// docs/data/reading-units.md.
/// </summary>
public class ParashaDataService
{
    private static readonly Lazy<ParashaDataService> _instance = new(() => new ParashaDataService());

    /// <summary>Singleton instance of the ParashaDataService.</summary>
    public static ParashaDataService Instance => _instance.Value;

    private List<ParashaUnit>? _parashiot;
    private Dictionary<int, int>? _unitIndexById;
    private Dictionary<int, List<ParashaUnit>>? _unitsByPerekId;
    /// <summary>Volatile for the double-checked lock in <see cref="LoadAsync"/>.</summary>
    private volatile bool _isLoaded;
    private bool _isAvailable;
    private readonly SemaphoreSlim _loadLock = new(1, 1);

    private readonly LocalDatabaseService _databaseService;

    private ParashaDataService() : this(LocalDatabaseService.Instance) { }

    public ParashaDataService(LocalDatabaseService databaseService) { _databaseService = databaseService; }

    /// <summary>Whether parasha data has been loaded.</summary>
    public bool IsLoaded => _isLoaded;

    /// <summary>Whether the packaged database actually ships parasha reading units.</summary>
    public bool IsAvailable => _isLoaded && _isAvailable;

    /// <summary>All 54 parasha units ordered by unit id, or null before load.</summary>
    public IReadOnlyList<ParashaUnit>? Parashiot => _parashiot;

    /// <summary>Loaded unit count — drives the "מתוך" position text.</summary>
    public int UnitCount => _parashiot?.Count ?? 0;

    /// <summary>
    /// Loads every parasha unit with its primary Torah range and ordered
    /// Haftarah auxiliary ranges. Publishes one complete list so a
    /// concurrent reader never sees a half-filled catalog.
    /// </summary>
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
        finally { _loadLock.Release(); }
    }

    private async Task LoadUnitsAsync(SQLiteAsyncConnection db)
    {
        List<ReadingUnitRangeRow> rows;
        try
        {
            // Primary ranges carry NULL auxiliary_ordinal; ordering them
            // first keeps each unit's Torah range ahead of its ordered
            // Haftarah variants.
            rows = await db.QueryAsync<ReadingUnitRangeRow>(
                "SELECT u.unit_id AS unit_id, u.slug AS slug, u.sefer_id AS sefer_id, " +
                "u.unit_order AS unit_order, u.heading AS heading, " +
                "s.name AS sefer_name, " +
                "r.range_index AS range_index, r.auxiliary_ordinal AS auxiliary_ordinal, " +
                "r.auxiliary_id AS auxiliary_id, r.auxiliary_label AS auxiliary_label, " +
                "r.start_perek_id AS start_perek_id, r.start_pasuk AS start_pasuk, " +
                "r.start_segment_index AS start_segment_index, " +
                "r.end_perek_id AS end_perek_id, r.end_pasuk AS end_pasuk, " +
                "r.end_segment_index AS end_segment_index " +
                "FROM tanah_reading_unit u " +
                "LEFT JOIN tanah_reading_unit_range r " +
                "  ON r.division_id = u.division_id AND r.unit_id = u.unit_id " +
                "LEFT JOIN tanah_sefer s ON s.id = u.sefer_id " +
                "WHERE u.division_id = 'parasha' " +
                "ORDER BY u.unit_id, " +
                "  CASE WHEN r.auxiliary_ordinal IS NULL THEN -1 ELSE r.auxiliary_ordinal END, " +
                "  r.range_index");
        }
        catch (SQLiteException ex)
        {
            // A packaged database predating the reading-unit tables (or a
            // corrupt install) must not crash the reader — the page shows
            // its unavailable empty state instead.
            Console.Error.WriteLine($"[Parasha] reading-unit tables unavailable: {ex.Message}");
            _parashiot = new List<ParashaUnit>();
            _unitIndexById = new Dictionary<int, int>();
            _unitsByPerekId = new Dictionary<int, List<ParashaUnit>>();
            _isAvailable = false;
            return;
        }

        var units = new List<ParashaUnit>();
        foreach (var row in rows)
        {
            if (units.Count == 0 || units[^1].UnitId != row.UnitId)
            {
                units.Add(new ParashaUnit
                {
                    UnitId = row.UnitId,
                    Slug = row.Slug,
                    SeferId = row.SeferId,
                    SeferName = row.SeferName ?? string.Empty,
                    Order = row.UnitOrder,
                    Heading = row.Heading,
                    TorahRange = new ScriptureRange()
                });
            }

            // A unit without any range row (impossible in the export —
            // every parasha maps scripture) still yields one LEFT JOIN
            // row whose start columns are NULL.
            if (row.StartPerekId == 0 && row.RangeIndex == 0 && row.AuxiliaryId == null)
            {
                continue;
            }

            var unit = units[^1];
            var range = new ScriptureRange
            {
                StartPerekId = row.StartPerekId,
                StartPasuk = row.StartPasuk,
                StartSegmentIndex = row.StartSegmentIndex,
                EndPerekId = row.EndPerekId,
                EndPasuk = row.EndPasuk,
                EndSegmentIndex = row.EndSegmentIndex
            };

            if (row.AuxiliaryOrdinal is not int ordinal)
            {
                unit.TorahRange = range;
                continue;
            }

            var haftarot = unit.Haftarot;
            if (haftarot.Count <= ordinal)
            {
                haftarot.Add(new AuxiliaryReading
                {
                    Id = row.AuxiliaryId ?? string.Empty,
                    Label = row.AuxiliaryLabel ?? string.Empty
                });
            }

            haftarot[ordinal].Ranges.Add(range);
        }

        var unitIndexById = new Dictionary<int, int>(units.Count);
        var unitsByPerekId = new Dictionary<int, List<ParashaUnit>>();
        for (var index = 0; index < units.Count; index++)
        {
            var unit = units[index];
            unitIndexById.TryAdd(unit.UnitId, index);
            // Containment lookups ride the primary Torah range — a pasuk
            // belongs to exactly one parasha there (Haftarah variants only
            // repeat Neviim readings inside their own parasha).
            for (var perekId = unit.TorahRange.StartPerekId; perekId <= unit.TorahRange.EndPerekId; perekId++)
            {
                if (!unitsByPerekId.TryGetValue(perekId, out var bucket))
                {
                    bucket = new List<ParashaUnit>();
                    unitsByPerekId[perekId] = bucket;
                }
                bucket.Add(unit);
            }
        }

        _parashiot = units;
        _unitIndexById = unitIndexById;
        _unitsByPerekId = unitsByPerekId;
        _isAvailable = units.Count > 0;
    }

    /// <summary>Gets a parasha unit by its stable unit id, or null.</summary>
    public ParashaUnit? GetParasha(int unitId) =>
        _parashiot?.FirstOrDefault(unit => unit.UnitId == unitId);

    /// <summary>The unit's position in canonical order (-1 when missing).</summary>
    public int GetUnitIndex(int unitId) =>
        _unitIndexById != null && _unitIndexById.TryGetValue(unitId, out var index) ? index : -1;

    /// <summary>Adjacent units by canonical order, for prev/next navigation.</summary>
    public (ParashaUnit? Prev, ParashaUnit? Next) GetAdjacentUnits(int unitId)
    {
        var index = GetUnitIndex(unitId);
        if (_parashiot == null || index < 0)
        {
            return (null, null);
        }
        var prev = index > 0 ? _parashiot[index - 1] : null;
        var next = index < _parashiot.Count - 1 ? _parashiot[index + 1] : null;
        return (prev, next);
    }

    /// <summary>
    /// The parasha whose Torah range contains the given canonical pasuk —
    /// resolves perek-level deep links and the reader's resume point to the
    /// selected reading instance.
    /// </summary>
    public ParashaUnit? GetParashaContainingPasuk(int perekId, int pasuk)
    {
        if (_unitsByPerekId == null
            || !_unitsByPerekId.TryGetValue(perekId, out var candidates))
        {
            return null;
        }
        return candidates.FirstOrDefault(unit =>
            RangeContainsPasuk(unit.TorahRange, perekId, pasuk));
    }

    /// <summary>Whole-pasuk containment inside an inclusive range.</summary>
    internal static bool RangeContainsPasuk(ScriptureRange range, int perekId, int pasuk)
    {
        var afterStart = perekId > range.StartPerekId
            || (perekId == range.StartPerekId && pasuk >= range.StartPasuk);
        var beforeEnd = perekId < range.EndPerekId
            || (perekId == range.EndPerekId && pasuk <= range.EndPasuk);
        return afterStart && beforeEnd;
    }

    /// <summary>
    /// The pasuk bounds a range contributes inside one perek, or null
    /// when the range does not cover the perek. Whole-pasuk clipping is
    /// the contract granularity for parasha/haftarah data; boundary
    /// pesukim are included whole.
    /// </summary>
    public static (int Start, int End)? PasukBoundsForPerek(ScriptureRange range, int perekId)
    {
        if (perekId < range.StartPerekId || perekId > range.EndPerekId)
        {
            return null;
        }
        var start = perekId == range.StartPerekId ? range.StartPasuk : 1;
        var end = perekId == range.EndPerekId ? range.EndPasuk : int.MaxValue;
        return (start, end);
    }

    /// <summary>Filters a perek's pesukim to the range's bounds.</summary>
    public static List<Pasuk> ClipPasukim(IEnumerable<Pasuk> pasukim, ScriptureRange range, int perekId)
    {
        var bounds = PasukBoundsForPerek(range, perekId);
        if (bounds is null)
        {
            return [];
        }
        var (start, end) = bounds.Value;
        return pasukim.Where(pasuk => pasuk.PasukNum >= start && pasuk.PasukNum <= end).ToList();
    }

    /// <summary>Distinct canonical perek ids a reading's ranges cover, in range order.</summary>
    public static List<int> PerekIdsForRange(ScriptureRange range) =>
        Enumerable.Range(range.StartPerekId, range.EndPerekId - range.StartPerekId + 1).ToList();

    private class ReadingUnitRangeRow
    {
        [Column("unit_id")]
        public int UnitId { get; set; }

        [Column("slug")]
        public string Slug { get; set; } = string.Empty;

        [Column("sefer_id")]
        public int SeferId { get; set; }

        [Column("unit_order")]
        public int UnitOrder { get; set; }

        [Column("heading")]
        public string Heading { get; set; } = string.Empty;

        [Column("sefer_name")]
        public string? SeferName { get; set; }

        [Column("range_index")]
        public int RangeIndex { get; set; }

        [Column("auxiliary_ordinal")]
        public int? AuxiliaryOrdinal { get; set; }

        [Column("auxiliary_id")]
        public string? AuxiliaryId { get; set; }

        [Column("auxiliary_label")]
        public string? AuxiliaryLabel { get; set; }

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
