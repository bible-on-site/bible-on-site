using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using BibleOnSite.Models;

namespace BibleOnSite.Services;

/// <summary>Independent store-delivered book packs; playback uses verified, persistent local audio.</summary>
public sealed class RecitationService
{
    private static readonly Lazy<RecitationService> Shared = new(() => new(FileSystem.Current, PadDeliveryService.Instance));
    public static RecitationService Instance => Shared.Value;
    private readonly IFileSystem _files;
    private readonly IPadDeliveryService _delivery;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly SemaphoreSlim _downloadGate = new(1, 1);
    private Dictionary<int, RecitationTrack> _tracks = new();
    private List<RecitationBookPack> _books = [];
    private bool _initialized;
#pragma warning disable S3264 // Subscribed by platform XAML controls excluded from test compilation.
    public event EventHandler? Changed;
    public event EventHandler? PlaybackStopRequested;
#pragma warning restore S3264
    public void RequestPlaybackStop() => PlaybackStopRequested?.Invoke(this, EventArgs.Empty);
    public bool IsInstalled => _tracks.Count > 0;
    public IReadOnlyCollection<RecitationTrack> Tracks => _tracks.Values;
    public IReadOnlyList<RecitationBookPack> Books => _books;
    private string DirectoryPath => Path.Combine(_files.AppDataDirectory, "extensions", "recitation");
    private string AudioPath(RecitationTrack track) => Path.Combine(DirectoryPath, track.AudioSha256 + ".mp3");

    public RecitationService(IFileSystem files, IPadDeliveryService delivery)
    {
        _files = files;
        _delivery = delivery;
    }

    public async Task InitializeAsync()
    {
        if (!_initialized) await UpdateAsync();
    }

    public RecitationTrack? GetTrack(int perekId) => _tracks.GetValueOrDefault(perekId);
    public bool HasAudio(int perekId) => GetTrack(perekId) is { } track && File.Exists(AudioPath(track));

    // Timings are coupled to the installed app release, just like the Perushim catalog.
    public Task RefreshIfStaleAsync() => InitializeAsync();

    public async Task UpdateAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using var stream = await _files.OpenAppPackageFileAsync(RecitationExtensionCatalog.FileName);
            var catalog = await JsonSerializer.DeserializeAsync(stream,
                RecitationJsonContext.Default.RecitationExtensionCatalog, cancellationToken)
                ?? throw new InvalidDataException("Missing recitation extension catalog.");
            catalog.Validate();
            cancellationToken.ThrowIfCancellationRequested();
            _tracks = catalog.Package.Tracks.ToDictionary(t => t.PerekId);
            _books = catalog.Books;
            _initialized = true;
        }
        finally { _gate.Release(); }
        Changed?.Invoke(this, EventArgs.Empty);
    }

    public async Task DownloadAsync(IEnumerable<int> perekIds, IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        await InitializeAsync();
        await _downloadGate.WaitAsync(cancellationToken);
        try
        {
            var selected = perekIds.ToHashSet();
            var books = _books.Where(b => b.PerekIds.Any(selected.Contains)).ToList();
            if (books.Count == 0) throw new InvalidOperationException("No recordings for the selected books.");
            Directory.CreateDirectory(DirectoryPath);
            var total = books.Sum(b => b.SizeBytes);
            long completed = 0;
            foreach (var book in books)
            {
                var tracks = book.PerekIds.Select(id => _tracks[id]).DistinctBy(t => t.AudioSha256).ToList();
                var missing = new List<RecitationTrack>();
                foreach (var track in tracks)
                {
                    if (!await MatchesHashAsync(AudioPath(track), track.AudioSha256, cancellationToken)) missing.Add(track);
                }
                if (missing.Count > 0)
                {
                    var prior = completed;
                    // A synchronous adapter prevents late progress callbacks from earlier packs.
                    var downloadProgress = new InlineProgress(value => progress?.Report(
                        (prior + Math.Clamp(value, 0, 1) * book.SizeBytes * 0.9) / total));
                    await InstallBookAsync(book, tracks, missing, downloadProgress, cancellationToken);
                }
                completed += book.SizeBytes;
                progress?.Report((double)completed / total);
            }
        }
        finally
        {
            _downloadGate.Release();
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    private async Task InstallBookAsync(RecitationBookPack book, List<RecitationTrack> tracks,
        List<RecitationTrack> missing, IProgress<double> progress, CancellationToken cancellationToken)
    {
        var directory = await _delivery.TryGetAssetPathAsync(book.PackName, cancellationToken);
        if (directory == null && await _delivery.FetchAsync(book.PackName, progress, cancellationToken))
            directory = await _delivery.TryGetAssetPathAsync(book.PackName, cancellationToken);
        var path = directory == null ? null : new[] { Path.Combine(directory, book.FileName),
            Path.Combine(directory, "assets", book.FileName) }.FirstOrDefault(File.Exists);
        var bundledCopy = Path.Combine(DirectoryPath, book.FileName + ".download");
        try
        {
            if (path == null)
            {
                // Windows and sideloaded Debug builds use the same payload as a package asset.
                // Store mobile builds never bundle this fallback and never contact S3.
                await using var bundled = await _files.OpenAppPackageFileAsync(book.FileName);
                await using (var file = File.Create(bundledCopy)) await bundled.CopyToAsync(file, cancellationToken);
                path = bundledCopy;
            }
            if (new FileInfo(path).Length != book.SizeBytes || !await MatchesHashAsync(path, book.Sha256, cancellationToken))
                throw new InvalidDataException("Recording book package does not match this app release.");
            using var zip = ZipFile.OpenRead(path);
            var expected = tracks.Select(t => t.AudioSha256 + ".mp3").ToHashSet();
            if (zip.Entries.Count != expected.Count || !zip.Entries.Select(e => e.FullName).ToHashSet().SetEquals(expected))
                throw new InvalidDataException("Unexpected or missing recordings in book package.");
            foreach (var track in missing)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var destination = AudioPath(track);
                var temporary = destination + ".download";
                try
                {
                    await using var source = zip.GetEntry(track.AudioSha256 + ".mp3")!.Open();
                    await using (var file = File.Create(temporary)) await source.CopyToAsync(file, cancellationToken);
                    if (!await MatchesHashAsync(temporary, track.AudioSha256, cancellationToken))
                        throw new InvalidDataException("Recording checksum mismatch.");
                    cancellationToken.ThrowIfCancellationRequested();
                    File.Move(temporary, destination, true);
                }
                finally { File.Delete(temporary); }
            }
        }
        finally { File.Delete(bundledCopy); }
    }

    private sealed class InlineProgress(Action<double> report) : IProgress<double>
    {
        public void Report(double value) => report(value);
    }

    public Task<string> PrepareAudioAsync(int perekId, IReadOnlyList<Pasuk> pasukim) =>
        PrepareAudioAsync(perekId, pasukim, null, null, CancellationToken.None, null, null);

    public Task<string> PrepareAudioAsync(int perekId, IReadOnlyList<Pasuk> pasukim, double startMs, double endMs) =>
        PrepareAudioAsync(perekId, pasukim, startMs, endMs, CancellationToken.None, null, null);

    public Task<string> PrepareAudioAsync(int perekId, IReadOnlyList<Pasuk> pasukim, double startMs, double endMs, IRecitationAudioDecoder decoder) =>
        PrepareAudioAsync(perekId, pasukim, startMs, endMs, CancellationToken.None, null, decoder);

    public Task<string> PrepareAudioAsync(int perekId, IReadOnlyList<Pasuk> pasukim, IReadOnlyList<(double Start, double End)> ranges, IRecitationAudioDecoder decoder) =>
        PrepareAudioAsync(perekId, pasukim, null, null, CancellationToken.None, ranges, decoder);

    public Task<string> PrepareAudioAsync(int perekId, IReadOnlyList<Pasuk> pasukim,
        double? startMs, double? endMs, CancellationToken cancellationToken,
        IReadOnlyList<(double Start, double End)>? ranges, IRecitationAudioDecoder? decoder) =>
        PrepareAudioAsync(perekId, pasukim, startMs, endMs, cancellationToken, ranges, decoder, 0);

    public async Task<string> PrepareAudioAsync(int perekId, IReadOnlyList<Pasuk> pasukim,
        double? startMs, double? endMs, CancellationToken cancellationToken,
        IReadOnlyList<(double Start, double End)>? ranges, IRecitationAudioDecoder? decoder, double pauseMs)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var track = GetTrack(perekId) ?? throw new InvalidOperationException("No recording for this chapter.");
            if (!track.Matches(pasukim))
            {
                throw new InvalidDataException("Recording does not match the installed Bible text.");
            }

            if (startMs.HasValue != endMs.HasValue || ((startMs.HasValue || ranges != null) && track.AlignmentStatus != "ready"))
            {
                throw new InvalidDataException("Word timings are not approved.");
            }

            var intervals = ranges ?? (startMs.HasValue ? new List<(double Start, double End)> { (startMs.Value, endMs!.Value) } : null);
            if (intervals != null)
            {
                var published = track.Words.Select(w => (w.StartMs!.Value, w.EndMs!.Value))
                    .Concat(track.Words.GroupBy(w => w.Pasuk).Select(g => (g.First().StartMs!.Value, g.Last().EndMs!.Value))).ToHashSet();
                if (intervals.Count == 0 || intervals.Any(i => !published.Contains(i)))
                {
                    throw new InvalidDataException("Playback must use original approved intervals.");
                }
            }
            var mp3 = AudioPath(track);
            if (!await MatchesHashAsync(mp3, track.AudioSha256, cancellationToken))
            {
                throw new InvalidDataException("Download this book's recordings again in preferences.");
            }

            var cache = Path.Combine(_files.CacheDirectory, "recitation");
            Directory.CreateDirectory(cache);
            foreach (var old in Directory.EnumerateFiles(cache, "*.wav"))
            {
                // Native players may finish releasing the previous file asynchronously.
                try { File.Delete(old); } catch (IOException) { /* The native player can retain its last file until asynchronous release. */ }
            }
            cancellationToken.ThrowIfCancellationRequested();
            if (ranges == null && (startMs is not double || endMs is not double))
            {
                return mp3;
            }

            var clip = Path.Combine(cache, "clip-" + Guid.NewGuid().ToString("N") + ".wav");
            if (decoder == null)
            {
                throw new InvalidOperationException("A precise audio decoder is required.");
            }

            if (!double.IsFinite(pauseMs) || pauseMs < 0 || pauseMs > 10000)
            {
                throw new InvalidDataException("Invalid verse pause.");
            }
            var pcm = pauseMs > 0
                ? await decoder.CreateClipAsync(mp3, intervals!, cancellationToken, pauseMs)
                : await decoder.CreateClipAsync(mp3, intervals!, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            await File.WriteAllBytesAsync(clip, pcm, cancellationToken);
            return clip;
        }
        finally { _gate.Release(); }
    }

    private static async Task<bool> MatchesHashAsync(string path, string expected, CancellationToken cancellationToken)
    {
        if (!File.Exists(path))
        {
            return false;
        }

        await using var file = File.OpenRead(path);
        return Convert.ToHexStringLower(await SHA256.HashDataAsync(file, cancellationToken)) == expected;
    }

}
