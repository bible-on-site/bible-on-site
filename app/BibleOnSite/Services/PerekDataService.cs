using BibleOnSite.Helpers;
using BibleOnSite.Models;
using System.Text;
using Newtonsoft.Json;
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

    private PerekDataService() { }

    /// <summary>
    /// Whether perek data has been loaded.
    /// </summary>
    public bool IsLoaded => _isLoaded;

    /// <summary>
    /// Dictionary of all perakim indexed by perekId (1-929).
    /// </summary>
    public IReadOnlyDictionary<int, Perek>? Perakim => _perakim;

    /// <summary>
    /// Loads all sefarim and perakim from the database.
    /// </summary>
    public async Task LoadAsync()
    {
        if (_isLoaded)
            return;

        var db = await LocalDatabaseService.Instance.GetDatabaseAsync();

        // Load sefarim first
        await LoadSefarimAsync(db);

        // Load perakim
        await LoadPerakimAsync(db);

        _isLoaded = true;
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
                var nameDict = JsonConvert.DeserializeObject<Dictionary<string, string>>(row.TanahUsName);
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

        var perekRows = await db.QueryAsync<PerekRow>(
            "SELECT p.id AS perek_id, " +
            "p.perek, " +
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
            "LEFT JOIN tanah_perek_date pd ON pd.perek_id = p.id AND pd.cycle = (" +
            "  SELECT MAX(pd2.cycle) FROM tanah_perek_date pd2 WHERE pd2.perek_id = p.id" +
            ") " +
            "ORDER BY p.id");

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
                PerekNumber = row.PerekInContext,
                SeferId = row.SeferId,
                SeferName = row.SeferName ?? sefer?.Name ?? string.Empty,
                SeferTanahUsName = seferTanahUsName,
                Tseit = row.Tseit ?? string.Empty
            };
        }
    }

    /// <summary>
    /// Gets a perek by ID.
    /// </summary>
    public Perek? GetPerek(int perekId)
    {
        return _perakim?.GetValueOrDefault(perekId);
    }

    /// <summary>
    /// Gets today's perek ID based on the date stored in the database.
    /// If today is Shabbat, returns the next day's perek.
    /// Uses the tseit (star rise) time to determine if we've crossed into the next perek.
    /// </summary>
    public int GetTodaysPerekId()
    {
        if (_perakim == null || _perakim.Count == 0)
            return 1;

        var now = DateTime.Now;
        var dateStr = now.ToString("yyyy-MM-dd");

        // Check if it's Shabbat (Saturday = 6 in .NET, Friday = 5)
        // On Shabbat, skip to Sunday's perek
        if (now.DayOfWeek == DayOfWeek.Saturday)
        {
            return GetTodaysPerekId(now.AddDays(1));
        }

        return GetTodaysPerekId(now);
    }

    private int GetTodaysPerekId(DateTime date)
    {
        var dateStr = date.ToString("yyyy-MM-dd");

        for (int perekId = 1; perekId <= 929; perekId++)
        {
            if (_perakim!.TryGetValue(perekId, out var perek) && perek.Date == dateStr)
            {
                // Check if we've passed the tseit time
                if (!string.IsNullOrEmpty(perek.Tseit) && perek.Tseit.Length >= 5)
                {
                    if (int.TryParse(perek.Tseit[..2], out var hours) &&
                        int.TryParse(perek.Tseit.Substring(3, 2), out var minutes))
                    {
                        var tseitTime = new DateTime(date.Year, date.Month, date.Day, hours, minutes, 0);
                        if (DateTime.Now > tseitTime && perekId < 929)
                        {
                            return perekId + 1;
                        }
                    }
                }
                return perekId;
            }
        }

        // Fallback to first perek if no date match found
        return 1;
    }

    /// <summary>
    /// Loads the pasukim text for a given perek.
    /// </summary>
    public async Task<List<Pasuk>> LoadPasukimAsync(int perekId)
    {
        var db = await LocalDatabaseService.Instance.GetDatabaseAsync();

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

            switch (row.SegmentType)
            {
                case "ktiv":
                case "qri":
                    if (!string.IsNullOrEmpty(value))
                    {
                        // Add space before word unless:
                        // - it's the first word
                        // - previous char is a newline
                        // - previous char is a maqaf (Hebrew hyphen)
                        if (currentText.Length > 0 && currentText[^1] != '\n' && currentText[^1] != '־')
                        {
                            currentText.Append(' ');
                        }
                        currentText.Append(value);
                    }
                    break;
                case "ptuha":
                case "stuma":
                    if (currentText.Length > 0 && currentText[^1] != '\n')
                    {
                        currentText.Append('\n');
                    }
                    break;
            }
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
            return null;

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
            return string.Empty;

        if (date.Length == 8)
        {
            return $"{date[..4]}-{date.Substring(4, 2)}-{date.Substring(6, 2)}";
        }

        return date.Length >= 10 ? date[..10] : date;
    }

    private static string FormatHebrewDate(string? hebDate)
    {
        if (string.IsNullOrWhiteSpace(hebDate))
            return string.Empty;

        if (hebDate.Length != 8 || !int.TryParse(hebDate, out var _))
            return hebDate;

        var year = int.Parse(hebDate[..4]);
        var month = int.Parse(hebDate.Substring(4, 2));
        var day = int.Parse(hebDate.Substring(6, 2));

        var dayText = day.ToHebrewLetters();
        var monthText = GetHebrewMonthName(month, IsHebrewLeapYear(year));
        var yearText = GimatryHelper.ToLetters(year % 1000);

        return string.IsNullOrEmpty(monthText)
            ? hebDate
            : $"{dayText} {monthText} {yearText}";
    }

    private static bool IsHebrewLeapYear(int hebrewYear)
    {
        // Leap years in the 19-year cycle: 3, 6, 8, 11, 14, 17, 19
        var mod = hebrewYear % 19;
        return mod is 0 or 3 or 6 or 8 or 11 or 14 or 17;
    }

    private static string GetHebrewMonthName(int month, bool isLeapYear)
    {
        return month switch
        {
            1 => "תשרי",
            2 => "חשוון",
            3 => "כסלו",
            4 => "טבת",
            5 => "שבט",
            6 => isLeapYear ? "אדר א" : "אדר",
            7 => isLeapYear ? "אדר ב" : "ניסן",
            8 => isLeapYear ? "ניסן" : "אייר",
            9 => isLeapYear ? "אייר" : "סיון",
            10 => isLeapYear ? "סיון" : "תמוז",
            11 => isLeapYear ? "תמוז" : "אב",
            12 => isLeapYear ? "אב" : "אלול",
            13 => "אלול",
            _ => string.Empty
        };
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
