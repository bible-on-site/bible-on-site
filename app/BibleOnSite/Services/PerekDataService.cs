using BibleOnSite.Helpers;
using BibleOnSite.Models;
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

        var seferRows = await db.QueryAsync<SeferRow>("SELECT * FROM tanah_sefer ORDER BY sefer_id");

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
            "SELECT perek_id, additional, date, has_recording, header, hebdate, perek, sefer_id, tseit FROM tanah_perek WHERE perek_id IS NOT NULL");

        foreach (var row in perekRows)
        {
            var sefer = _sefarim!.GetValueOrDefault(row.SeferId);

            string seferTanahUsName;
            if (sefer != null)
            {
                seferTanahUsName = sefer.GetTanahUsName(row.Additional == 0 ? null : row.Additional);
            }
            else
            {
                seferTanahUsName = string.Empty;
            }

            _perakim[row.PerekId] = new Perek
            {
                PerekId = row.PerekId,
                Additional = row.Additional == 0 ? null : row.Additional,
                Date = row.Date.Length >= 10 ? row.Date[..10] : row.Date,
                HasRecording = row.HasRecording == 1,
                Header = row.Header ?? string.Empty,
                HebDate = row.HebDate,
                PerekNumber = row.Perek,
                SeferId = row.SeferId,
                SeferName = sefer?.Name ?? string.Empty,
                SeferTanahUsName = seferTanahUsName,
                Tseit = row.Tseit
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
    /// Loads the pasukim text for a given perek.
    /// </summary>
    public async Task<List<Pasuk>> LoadPasukimAsync(int perekId)
    {
        var db = await LocalDatabaseService.Instance.GetDatabaseAsync();

        var pasukRows = await db.QueryAsync<PasukContentRow>(
            "SELECT pasuk, pasuk_content FROM tanah_app_pasuk_content WHERE perek_id = ? ORDER BY pasuk",
            perekId);

        var pasukim = new List<Pasuk>();

        foreach (var row in pasukRows)
        {
            var text = ParsePasukContent(row.PasukContent);
            pasukim.Add(new Pasuk
            {
                PasukNum = row.Pasuk,
                Text = text
            });
        }

        return pasukim;
    }

    private static string ParsePasukContent(string jsonContent)
    {
        try
        {
            // The content is a JSON array of text segments and formatting objects
            var components = JsonConvert.DeserializeObject<List<object>>(jsonContent);
            if (components == null)
                return string.Empty;

            var textParts = new List<string>();

            foreach (var component in components)
            {
                if (component is string text)
                {
                    // Skip parsha markers
                    if (text is "{ס}" or "{פ}" or "׆")
                        continue;
                    textParts.Add(text);
                }
                else if (component is Newtonsoft.Json.Linq.JObject obj)
                {
                    // Extract text value from formatting object (e.g., {"strong": "word"})
                    var value = obj.Values<Newtonsoft.Json.Linq.JToken>().FirstOrDefault()?.ToString();
                    if (!string.IsNullOrEmpty(value))
                        textParts.Add(value);
                }
            }

            return string.Join("", textParts);
        }
        catch
        {
            return jsonContent;
        }
    }

    #region Database Row Classes

    private class SeferRow
    {
        [Column("sefer_id")]
        public int SeferId { get; set; }

        [Column("name")]
        public string Name { get; set; } = string.Empty;

        [Column("tanah_us_name")]
        public string TanahUsName { get; set; } = string.Empty;
    }

    private class PerekRow
    {
        [Column("perek_id")]
        public int PerekId { get; set; }

        [Column("additional")]
        public int Additional { get; set; }

        [Column("date")]
        public string Date { get; set; } = string.Empty;

        [Column("has_recording")]
        public int HasRecording { get; set; }

        [Column("header")]
        public string? Header { get; set; }

        [Column("hebdate")]
        public string HebDate { get; set; } = string.Empty;

        [Column("perek")]
        public int Perek { get; set; }

        [Column("sefer_id")]
        public int SeferId { get; set; }

        [Column("tseit")]
        public string Tseit { get; set; } = string.Empty;
    }

    private class PasukContentRow
    {
        [Column("pasuk")]
        public int Pasuk { get; set; }

        [Column("pasuk_content")]
        public string PasukContent { get; set; } = string.Empty;
    }

    #endregion
}
