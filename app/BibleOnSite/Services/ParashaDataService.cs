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
    private bool _isLoaded;
    private readonly SemaphoreSlim _loadLock = new(1, 1);

    private readonly LocalDatabaseService _databaseService;

    private ParashaDataService() : this(LocalDatabaseService.Instance) { }

    public ParashaDataService(LocalDatabaseService databaseService) { _databaseService = databaseService; }

    /// <summary>Whether parasha data has been loaded.</summary>
    public bool IsLoaded => _isLoaded;

    /// <summary>All 54 parasha units ordered by unit id, or null before load.</summary>
    public IReadOnlyList<ParashaUnit>? Parashiot => _parashiot;

    /// <summary>
    /// Loads every parasha unit with its primary Torah range and ordered
    /// Haftarah auxiliary ranges. Publishes one complete list so a
    /// concurrent reader never sees a half-filled catalog.
    /// </summary>
    public async Task LoadAsync()
    {
        if (_isLoaded)
            return;

        await _loadLock.WaitAsync();
        try
        {
            if (_isLoaded)
            {
                return;
            }
            var db = await _databaseService.GetDatabaseAsync();

            // Primary ranges carry NULL auxiliary_ordinal; ordering them
            // first keeps each unit's Torah range ahead of its ordered
            // Haftarah variants.
            var rows = await db.QueryAsync<ReadingUnitRangeRow>(
                "SELECT u.unit_id AS unit_id, u.slug AS slug, u.sefer_id AS sefer_id, " +
                "u.unit_order AS unit_order, u.heading AS heading, " +
                "r.range_index AS range_index, r.auxiliary_ordinal AS auxiliary_ordinal, " +
                "r.auxiliary_id AS auxiliary_id, r.auxiliary_label AS auxiliary_label, " +
                "r.start_perek_id AS start_perek_id, r.start_pasuk AS start_pasuk, " +
                "r.start_segment_index AS start_segment_index, " +
                "r.end_perek_id AS end_perek_id, r.end_pasuk AS end_pasuk, " +
                "r.end_segment_index AS end_segment_index " +
                "FROM tanah_reading_unit u " +
                "LEFT JOIN tanah_reading_unit_range r " +
                "  ON r.division_id = u.division_id AND r.unit_id = u.unit_id " +
                "WHERE u.division_id = 'parasha' " +
                "ORDER BY u.unit_id, " +
                "  CASE WHEN r.auxiliary_ordinal IS NULL THEN -1 ELSE r.auxiliary_ordinal END, " +
                "  r.range_index");

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

            _parashiot = units;
            _isLoaded = true;
        }
        finally { _loadLock.Release(); }
    }

    /// <summary>Gets a parasha unit by its stable unit id, or null.</summary>
    public ParashaUnit? GetParasha(int unitId) =>
        _parashiot?.FirstOrDefault(unit => unit.UnitId == unitId);

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
