using BibleOnSite.Helpers;
using BibleOnSite.Models;
using System.Globalization;
using System.Text;
using System.Text.Json;
using SQLite;

namespace BibleOnSite.Services;

/// <summary>
/// Service for loading Perek data from the local SQLite database.
/// </summary>
public class PerekDataService
{
    private static readonly Lazy<PerekDataService> _instance = new(() => new PerekDataService());

    /// <summary>
    /// Singleton instance of the PerekDataService.
    /// </summary>
    public static PerekDataService Instance => _instance.Value;

    private Dictionary<int, Perek>? _perakim;
    private Dictionary<int, Sefer>? _sefarim;
    private bool _isLoaded;
    private readonly SemaphoreSlim _loadLock = new(1, 1);

    private readonly LocalDatabaseService _databaseService;
    private readonly PerekScheduleService _scheduleService;

    private PerekDataService() : this(LocalDatabaseService.Instance, PerekScheduleService.Instance) { }

    public PerekDataService(LocalDatabaseService databaseService)
        : this(databaseService, new PerekScheduleService(databaseService)) { }

    internal PerekDataService(LocalDatabaseService databaseService, PerekScheduleService scheduleService)
    {
        _databaseService = databaseService;
        _scheduleService = scheduleService;
    }

    /// <summary>
    /// Whether perek data has been loaded.
    /// </summary>
    public bool IsLoaded => _isLoaded;

    /// <summary>
    /// Dictionary of all perakim indexed by perekId (1-929).
    /// </summary>
    public IReadOnlyDictionary<int, Perek>? Perakim => _perakim;

    internal Task<SQLiteAsyncConnection> GetSearchConnectionAsync() => _databaseService.GetDatabaseAsync();

    /// <summary>
    /// Loads all sefarim and perakim from the database.
    /// </summary>
    public virtual async Task LoadAsync()
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
            // A replaced query and the background index can arrive together.
            // Publish one complete catalog instead of replacing its dictionaries
            // while another caller is already reading chapter search results.
            await _scheduleService.LoadAsync();
            await LoadSefarimAsync(db);
            await LoadPerakimAsync(db);
            _isLoaded = true;
        }
        finally { _loadLock.Release(); }
    }

    private async Task LoadSefarimAsync(SQLiteAsyncConnection db)
    {
        _sefarim = new Dictionary<int, Sefer>();

        var seferRows = await db.QueryAsync<SeferRow>(
            "SELECT id, name, tanach_us_name FROM tanah_sefer ORDER BY id");

        foreach (var row in seferRows)
        {
            string tanahUsName;
            if (row.TanahUsName.Contains('{'))
            {
                // Handle JSON format for split books
                var nameDict = JsonSerializer.Deserialize(row.TanahUsName, AppJsonContext.Default.SeferNames);
                tanahUsName = nameDict?.Values.FirstOrDefault() ?? row.TanahUsName;
            }
            else
            {
                tanahUsName = row.TanahUsName;
            }

            _sefarim[row.SeferId] = new Sefer
            {
                Id = row.SeferId,
                Name = row.Name,
                TanahUsName = tanahUsName
            };
        }
    }

    private async Task LoadPerakimAsync(SQLiteAsyncConnection db)
    {
        _perakim = new Dictionary<int, Perek>();

        // Perek dates shown in the reader come from the cycle containing
        // today (or the next cycle to start when today is unscheduled),
        // not simply the highest cycle stored in the table. Databases
        // without usable cycle rows keep the historical latest-cycle join.
        var displayCycle = _scheduleService.ConfirmedCycleCount > 0
            ? _scheduleService.GetCycleForDateOrUpcoming(HebrewDateHelper.GetTodayDateNumber()).Number
            : await GetLatestStoredCycleAsync(db);

        var perekRows = await db.QueryAsync<PerekRow>(
            "SELECT p.id AS perek_id, " +
            "p.perek, " +
            "p.header, " +
            "CASE " +
            "  WHEN a.id IS NOT NULL THEN p.id - a.perek_from + 1 " +
            "  ELSE p.id - s.perek_id_from + 1 " +
            "END AS perek_in_context, " +
            "s.id AS sefer_id, " +
            "s.name AS sefer_name, " +
            "s.tanach_us_name AS sefer_tanach_us_name, " +
            "a.letter AS additional_letter, " +
            "a.tanach_us_name AS additional_tanach_us_name, " +
            "pd.date AS date, " +
            "pd.hebdate AS hebdate, " +
            "pd.star_rise AS tseit " +
            "FROM tanah_perek p " +
            "JOIN tanah_sefer s ON p.id BETWEEN s.perek_id_from AND s.perek_id_to " +
            "LEFT JOIN tanah_additional a ON a.sefer_id = s.id AND p.id BETWEEN a.perek_from AND a.perek_to " +
            "LEFT JOIN tanah_perek_date pd ON pd.perek_id = p.id AND pd.cycle = ? " +
            "ORDER BY p.id",
            displayCycle);

        foreach (var row in perekRows)
        {
            var sefer = _sefarim!.GetValueOrDefault(row.SeferId);

            var additionalNumber = ParseAdditionalLetter(row.AdditionalLetter);
            var seferTanahUsName = !string.IsNullOrWhiteSpace(row.AdditionalTanahUsName)
                ? row.AdditionalTanahUsName
                : sefer?.GetTanahUsName(null) ?? string.Empty;

            _perakim[row.PerekId] = new Perek
            {
                PerekId = row.PerekId,
                Additional = additionalNumber,
                Date = FormatDate(row.Date),
                HasRecording = false,
                Header = row.Header ?? string.Empty,
                HebDate = FormatHebrewDate(row.HebDate),
                HebDateNumeric = ParseHebDateNumeric(row.HebDate),
                PerekNumber = row.PerekInContext,
                SeferId = row.SeferId,
                SeferName = row.SeferName ?? sefer?.Name ?? string.Empty,
                SeferTanahUsName = seferTanahUsName,
                Tseit = row.Tseit ?? string.Empty
            };
        }
    }

    /// <summary>
    /// Highest cycle stored in tanah_perek_date; 1 when the table is empty
    /// (preserves the pre-schedule latest-cycle join). A database without the
    /// table at all fails the perakim query below just as it always has.
    /// </summary>
    private static async Task<int> GetLatestStoredCycleAsync(SQLiteAsyncConnection db)
    {
        var latest = await db.ExecuteScalarAsync<int?>("SELECT MAX(cycle) FROM tanah_perek_date");
        return latest is > 0 ? latest.Value : 1;
    }

    /// <summary>
    /// Gets a perek by ID.
    /// </summary>
    public Perek? GetPerek(int perekId)
    {
        return _perakim?.GetValueOrDefault(perekId);
    }

    /// <summary>
    /// Gets the display source string for a perek (e.g., "בראשית א", "שמואל א ג").
    /// </summary>
    public string? GetPerekSource(int perekId)
    {
        var perek = GetPerek(perekId);
        if (perek == null)
        {
            return null;
        }

        var additionalPart = perek.Additional.HasValue ? $"{perek.Additional.Value.ToHebrewLetters()} " : string.Empty;
        return $"{perek.SeferName} {additionalPart}{perek.PerekNumber.ToHebrewLetters()}";
    }

    /// <summary>
    /// Readable label for a set of reviewed perakim (#2365), e.g. "בראשית א-ה".
    /// A contiguous run inside one sefer collapses to "ספר א-ה"; a run that
    /// crosses a sefer boundary spells both ends out; non-contiguous material
    /// lists each run so the label never implies unstudied perakim.
    /// </summary>
    public string GetPerekRangeSource(IReadOnlyList<int> perekIds)
    {
        if (perekIds.Count == 0)
        {
            return string.Empty;
        }

        var runs = new List<List<int>> { new List<int> { perekIds[0] } };
        foreach (var id in perekIds.Skip(1))
        {
            var run = runs[^1];
            if (id == run[^1] + 1)
            {
                run.Add(id);
            }
            else
            {
                runs.Add([id]);
            }
        }

        return string.Join(", ", runs.Select(run =>
        {
            var first = GetPerek(run[0]);
            var last = GetPerek(run[^1]);
            if (first is null || last is null || run.Count == 1)
            {
                return first is null ? string.Empty : GetPerekSource(run[0]) ?? string.Empty;
            }
            if (first.SeferId == last.SeferId && first.Additional == last.Additional)
            {
                var additionalPart = first.Additional.HasValue
                    ? $"{first.Additional.Value.ToHebrewLetters()} "
                    : string.Empty;
                return $"{first.SeferName} {additionalPart}" +
                    $"{first.PerekNumber.ToHebrewLetters()}-{last.PerekNumber.ToHebrewLetters()}";
            }
            return $"{GetPerekSource(run[0])} - {GetPerekSource(run[^1])}";
        }).Where(label => label.Length > 0));
    }

    /// <summary>
    /// Gets today's perek ID based on Hebrew date calculation.
    /// Delegates to the multi-cycle schedule so "today's perek" agrees with
    /// the לוח לימוד יומי calendar: scheduled days return their exact perek
    /// and review days the perek being reviewed, for every stored cycle.
    /// </summary>
    public int GetTodaysPerekId()
    {
        if (_perakim == null || _perakim.Count == 0)
        {
            return 1;
        }

        // LoadAsync always runs the schedule load before filling _perakim,
        // so a populated catalog implies a loaded schedule.
        return _scheduleService.GetTodaysPerekId();
    }

    /// <summary>
    /// Loads the pasukim text for a given perek.
    /// </summary>
    public virtual async Task<List<Pasuk>> LoadPasukimAsync(int perekId)
    {
        var db = await _databaseService.GetDatabaseAsync();

        var segmentRows = await db.QueryAsync<PasukSegmentRow>(
            "SELECT s.id AS segment_id, s.pasuk_id AS pasuk_id, s.segment_type AS segment_type, " +
            "v.value AS value, o.qri_ktiv_offset AS qri_ktiv_offset " +
            "FROM tanah_pasuk_segment s " +
            "LEFT JOIN tanah_pasuk_segment_value v ON v.id = s.id " +
            "LEFT JOIN tanah_pasuk_segment_qri_ktiv_offset o ON o.id = s.id " +
            "WHERE s.perek_id = ? " +
            "ORDER BY s.pasuk_id, s.id",
            perekId);

        var pasukim = new List<Pasuk>();
        var currentPasukId = -1;
        var currentText = new StringBuilder();
        var currentSegments = new List<PasukSegment>();

        foreach (var row in segmentRows)
        {
            if (row.PasukId != currentPasukId)
            {
                if (currentPasukId != -1)
                {
                    pasukim.Add(new Pasuk
                    {
                        PasukNum = currentPasukId,
                        Text = currentText.ToString().TrimEnd(),
                        Segments = new List<PasukSegment>(currentSegments)
                    });
                }

                currentPasukId = row.PasukId;
                currentText.Clear();
                currentSegments.Clear();
            }

            var value = row.Value ?? string.Empty;
            var segmentType = ParseSegmentType(row.SegmentType);
            var segment = new PasukSegment
            {
                Type = segmentType,
                Value = value,
                PairedOffset = row.QriKtivOffset
            };
            currentSegments.Add(segment);
            PerekDataServiceText.AppendSegmentText(currentText, segmentType, value);
        }

        if (currentPasukId != -1)
        {
            pasukim.Add(new Pasuk
            {
                PasukNum = currentPasukId,
                Text = currentText.ToString().TrimEnd(),
                Segments = new List<PasukSegment>(currentSegments)
            });
        }

        return pasukim;
    }

    private static SegmentType ParseSegmentType(string type)
    {
        return type switch
        {
            "ktiv" => SegmentType.Ktiv,
            "qri" => SegmentType.Qri,
            "ptuha" => SegmentType.Ptuha,
            "stuma" => SegmentType.Stuma,
            _ => SegmentType.Qri // Default to qri for unknown types
        };
    }

    private static int? ParseAdditionalLetter(string? letter)
    {
        if (string.IsNullOrWhiteSpace(letter))
        {
            return null;
        }

        return letter switch
        {
            "א" => 1,
            "ב" => 2,
            "ג" => 3,
            "ד" => 4,
            "ה" => 5,
            "ו" => 6,
            "ז" => 7,
            "ח" => 8,
            "ט" => 9,
            "י" => 10,
            _ => null
        };
    }

    private static string FormatDate(string? date)
    {
        if (string.IsNullOrWhiteSpace(date))
        {
            return string.Empty;
        }

        if (date.Length == 8)
        {
            return $"{date[..4]}-{date.Substring(4, 2)}-{date.Substring(6, 2)}";
        }

        return date.Length >= 10 ? date[..10] : date;
    }

    /// <summary>
    /// Parses Hebrew date from database format to numeric YYYYMMDD format.
    /// </summary>
    private static int ParseHebDateNumeric(string? hebDate)
    {
        if (string.IsNullOrWhiteSpace(hebDate) || hebDate.Length != 8)
        {
            return 0;
        }

        if (int.TryParse(hebDate, out var result))
        {
            return result;
        }

        return 0;
    }

    private static string FormatHebrewDate(string? hebDate)
    {
        if (string.IsNullOrWhiteSpace(hebDate))
        {
            return string.Empty;
        }

        if (hebDate.Length != 8 || !int.TryParse(hebDate, out var dateNum))
        {
            return hebDate;
        }

        var formatted = HebrewDateHelper.FormatHebrewDate(dateNum);
        return formatted == dateNum.ToString() ? hebDate : formatted;
    }

    #region Database Row Classes

    private class SeferRow
    {
        [Column("id")]
        public int SeferId { get; set; }

        [Column("name")]
        public string Name { get; set; } = string.Empty;

        [Column("tanach_us_name")]
        public string TanahUsName { get; set; } = string.Empty;
    }

    private class PerekRow
    {
        [Column("perek_id")]
        public int PerekId { get; set; }

        [Column("perek")]
        public int Perek { get; set; }

        [Column("perek_in_context")]
        public int PerekInContext { get; set; }

        [Column("sefer_id")]
        public int SeferId { get; set; }

        [Column("sefer_name")]
        public string? SeferName { get; set; }

        [Column("sefer_tanach_us_name")]
        public string? SeferTanachUsName { get; set; }

        [Column("additional_letter")]
        public string? AdditionalLetter { get; set; }

        [Column("additional_tanach_us_name")]
        public string? AdditionalTanahUsName { get; set; }

        [Column("date")]
        public string? Date { get; set; }

        [Column("hebdate")]
        public string? HebDate { get; set; }

        [Column("header")]
        public string? Header { get; set; }

        [Column("tseit")]
        public string? Tseit { get; set; }
    }

    private class PasukSegmentRow
    {
        [Column("segment_id")]
        public int SegmentId { get; set; }

        [Column("pasuk_id")]
        public int PasukId { get; set; }

        [Column("segment_type")]
        public string SegmentType { get; set; } = string.Empty;

        [Column("value")]
        public string? Value { get; set; }

        [Column("qri_ktiv_offset")]
        public int? QriKtivOffset { get; set; }
    }

    #endregion
}
