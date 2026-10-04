using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using BibleOnSite.Models;
using SQLite;

namespace BibleOnSite.Services;

/// <summary>A separate, optional SQLite extension and hash-addressed offline audio store.</summary>
public sealed class RecitationService
{
    private static readonly Lazy<RecitationService> Shared = new(() => new(FileSystem.Current, new HttpClient()));
    public static RecitationService Instance => Shared.Value;
    private readonly IFileSystem _files;
    private readonly HttpClient _http;
    private readonly Uri _packageUrl;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly SemaphoreSlim _downloadGate = new(1, 1);
    private Dictionary<int, RecitationTrack> _tracks = new();
    private bool _initialized;
    private DateTime _lastRefreshAttempt;
    public event EventHandler? Changed;
    public event EventHandler? PlaybackStopRequested;
    public void RequestPlaybackStop() => PlaybackStopRequested?.Invoke(this, EventArgs.Empty);
    public bool IsInstalled => _tracks.Count > 0;
    public IReadOnlyCollection<RecitationTrack> Tracks => _tracks.Values;
    private string DirectoryPath => Path.Combine(_files.AppDataDirectory, "extensions", "recitation");
    private string AudioPath(RecitationTrack track) => Path.Combine(DirectoryPath, track.AudioSha256 + ".mp3");

    public RecitationService(IFileSystem files, HttpClient http, Uri? packageUrl = null)
    {
        _files = files;
        _http = http;
        _packageUrl = packageUrl ?? new Uri(Environment.GetEnvironmentVariable("RECITATION_PACKAGE_URL") ??
            "https://xn--febl3a.co.il/api/recitation");
    }

    public async Task InitializeAsync()
    {
        await _gate.WaitAsync();
        try
        {
            if (_initialized) return;
            var path = Path.Combine(DirectoryPath, "recitation.sqlite");
            if (File.Exists(path))
            {
                using var db = new SQLiteConnection(path, SQLiteOpenFlags.ReadOnly);
                var package = new RecitationPackage(1, db.Table<TrackRow>().ToList()
                    .Select(r => JsonSerializer.Deserialize(r.Payload, RecitationJsonContext.Default.RecitationTrack)!).ToList());
                package.Validate();
                _tracks = package.Tracks.ToDictionary(t => t.PerekId);
            }
            _initialized = true;
        }
        finally { _gate.Release(); }
    }

    public RecitationTrack? GetTrack(int perekId) => _tracks.GetValueOrDefault(perekId);
    public bool HasAudio(int perekId) => GetTrack(perekId) is { } track && File.Exists(AudioPath(track));

    public async Task RefreshIfStaleAsync()
    {
        var path = Path.Combine(DirectoryPath, "recitation.sqlite");
        if (!IsInstalled || DateTime.UtcNow - _lastRefreshAttempt < TimeSpan.FromHours(1) ||
            DateTime.UtcNow - File.GetLastWriteTimeUtc(path) < TimeSpan.FromDays(1)) return;
        _lastRefreshAttempt = DateTime.UtcNow;
        try { await UpdateAsync(); }
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Offline recitation extension retained: {ex.Message}"); }
    }

    /// <summary>Refresh timing metadata atomically; already downloaded recordings are reused.</summary>
    public async Task UpdateAsync(CancellationToken cancellationToken = default)
    {
        var package = await _http.GetFromJsonAsync(_packageUrl, RecitationJsonContext.Default.RecitationPackage, cancellationToken)
            ?? throw new InvalidDataException("Missing recitation extension.");
        package.Validate();
        await _gate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(DirectoryPath);
            using var db = new SQLiteConnection(Path.Combine(DirectoryPath, "recitation.sqlite"));
            db.CreateTable<TrackRow>();
            db.RunInTransaction(() =>
            {
                db.DeleteAll<TrackRow>();
                foreach (var track in package.Tracks)
                    db.Insert(new TrackRow { PerekId = track.PerekId, Payload = JsonSerializer.Serialize(track, RecitationJsonContext.Default.RecitationTrack) });
            });
            _tracks = package.Tracks.ToDictionary(t => t.PerekId);
            _initialized = true;
        }
        finally { _gate.Release(); }
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public async Task DownloadAsync(IEnumerable<int> perekIds, IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        await _downloadGate.WaitAsync(cancellationToken);
        try
        {
            var tracks = perekIds.Distinct().Select(GetTrack).OfType<RecitationTrack>().ToList();
            if (tracks.Count == 0) throw new InvalidOperationException("No recordings in the selected books.");
            Directory.CreateDirectory(DirectoryPath);
            for (var index = 0; index < tracks.Count; index++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var track = tracks[index];
                var destination = AudioPath(track);
                if (!await MatchesHashAsync(destination, track.AudioSha256, cancellationToken))
                {
                    var temporary = destination + ".download";
                    try
                    {
                        using var response = await _http.GetAsync(track.AudioUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                        response.EnsureSuccessStatusCode();
                        await using (var input = await response.Content.ReadAsStreamAsync(cancellationToken))
                        await using (var output = File.Create(temporary))
                        {
                            var buffer = new byte[65536];
                            long total = 0;
                            int read;
                            while ((read = await input.ReadAsync(buffer, cancellationToken)) > 0)
                            {
                                await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                                total += read;
                                if (response.Content.Headers.ContentLength is > 0)
                                    progress?.Report((index + (double)total / response.Content.Headers.ContentLength.Value) / tracks.Count);
                            }
                        }
                        if (!await MatchesHashAsync(temporary, track.AudioSha256, cancellationToken))
                            throw new InvalidDataException("Recording checksum mismatch.");
                        File.Move(temporary, destination, true);
                    }
                    finally { File.Delete(temporary); }
                }
                progress?.Report((index + 1.0) / tracks.Count);
            }
        }
        finally
        {
            _downloadGate.Release();
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    public async Task<string> PrepareAudioAsync(int perekId, IReadOnlyList<Pasuk> pasukim,
        double? startMs = null, double? endMs = null, CancellationToken cancellationToken = default,
        IReadOnlyList<(double Start, double End)>? ranges = null, IRecitationAudioDecoder? decoder = null)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var track = GetTrack(perekId) ?? throw new InvalidOperationException("No recording for this chapter.");
            if (!track.Matches(pasukim)) throw new InvalidDataException("Recording does not match the installed Bible text.");
            if (startMs.HasValue != endMs.HasValue || ((startMs.HasValue || ranges != null) && track.AlignmentStatus != "ready"))
                throw new InvalidDataException("Word timings are not approved.");
            var intervals = ranges ?? (startMs.HasValue ? new List<(double Start, double End)> { (startMs.Value, endMs!.Value) } : null);
            if (intervals != null)
            {
                var published = track.Words.Select(w => (w.StartMs!.Value, w.EndMs!.Value))
                    .Concat(track.Words.GroupBy(w => w.Pasuk).Select(g => (g.First().StartMs!.Value, g.Last().EndMs!.Value))).ToHashSet();
                if (intervals.Count == 0 || intervals.Any(i => !published.Contains(i)))
                    throw new InvalidDataException("Playback must use original approved intervals.");
            }
            var mp3 = AudioPath(track);
            if (!await MatchesHashAsync(mp3, track.AudioSha256, cancellationToken))
                throw new InvalidDataException("Download this book's recordings again in preferences.");
            var cache = Path.Combine(_files.CacheDirectory, "recitation");
            Directory.CreateDirectory(cache);
            foreach (var old in Directory.EnumerateFiles(cache, "*.wav"))
            {
                // Native players may finish releasing the previous file asynchronously.
                try { File.Delete(old); } catch (IOException) { }
            }
            cancellationToken.ThrowIfCancellationRequested();
            if (ranges == null && (startMs is not double || endMs is not double)) return mp3;
            var clip = Path.Combine(cache, "clip-" + Guid.NewGuid().ToString("N") + ".wav");
            if (decoder == null) throw new InvalidOperationException("A precise audio decoder is required.");
            var pcm = await decoder.CreateClipAsync(mp3, intervals!, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            await File.WriteAllBytesAsync(clip, pcm, cancellationToken);
            return clip;
        }
        finally { _gate.Release(); }
    }

    private static async Task<bool> MatchesHashAsync(string path, string expected, CancellationToken cancellationToken)
    {
        if (!File.Exists(path)) return false;
        await using var file = File.OpenRead(path);
        return Convert.ToHexStringLower(await SHA256.HashDataAsync(file, cancellationToken)) == expected;
    }

    [Table("recitation_track")]
    private sealed class TrackRow
    {
        [PrimaryKey] public int PerekId { get; set; }
        public string Payload { get; set; } = "";
    }
}
