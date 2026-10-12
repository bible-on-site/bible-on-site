using System.Buffers.Binary;
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
    private readonly Func<bool> _playsOggNatively;
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
    private string AudioPath(RecitationTrack track) => Path.Combine(DirectoryPath, track.PlaybackFileName);

    public RecitationService(IFileSystem files, IPadDeliveryService delivery)
        : this(files, delivery, null)
    {
    }

    public RecitationService(IFileSystem files, IPadDeliveryService delivery, Func<bool>? playsOggNatively)
    {
        _files = files;
        _delivery = delivery;
        // Tests inject the Android arm; runtime delegates to the platform check.
        _playsOggNatively = playsOggNatively ?? OperatingSystem.IsAndroid;
    }

    public async Task InitializeAsync()
    {
        if (!_initialized)
        {
            await UpdateAsync();
        }
    }

    public RecitationTrack? GetTrack(int perekId) => _tracks.GetValueOrDefault(perekId);
    public bool HasAudio(int perekId) => GetTrack(perekId) is { } track && File.Exists(AudioPath(track));

    // Timings are coupled to the installed app release, just like the Perushim catalog.
    public Task RefreshIfStaleAsync() => InitializeAsync();

    public Task UpdateAsync() => UpdateAsync(CancellationToken.None);

    public async Task UpdateAsync(CancellationToken cancellationToken)
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

    public Task DownloadAsync(IEnumerable<int> perekIds) => DownloadAsync(perekIds, null, CancellationToken.None);

    public Task DownloadAsync(IEnumerable<int> perekIds, IProgress<double>? progress) =>
        DownloadAsync(perekIds, progress, CancellationToken.None);

    public async Task DownloadAsync(IEnumerable<int> perekIds, IProgress<double>? progress,
        CancellationToken cancellationToken)
    {
        await InitializeAsync();
        await _downloadGate.WaitAsync(cancellationToken);
        try
        {
            var selected = perekIds.ToHashSet();
            var books = _books.Where(b => b.PerekIds.Any(selected.Contains)).ToList();
            if (books.Count == 0)
            {
                throw new InvalidOperationException("No recordings for the selected books.");
            }
            Directory.CreateDirectory(DirectoryPath);
            var total = books.Sum(b => b.SizeBytes);
            long completed = 0;
            foreach (var book in books)
            {
                var tracks = book.PerekIds.Select(id => _tracks[id]).DistinctBy(t => t.PlaybackFileName).ToList();
                var missing = new List<RecitationTrack>();
                foreach (var track in tracks)
                {
                    if (!await MatchesHashAsync(AudioPath(track), track.PlaybackSha256, cancellationToken))
                    {
                        missing.Add(track);
                    }
                }
                if (missing.Count > 0)
                {
                    var prior = completed;
                    // A synchronous adapter prevents late progress callbacks from earlier packs.
                    var downloadProgress = new InlineProgress(value => progress?.Report(
                        (prior + Math.Clamp(value, 0, 1) * book.SizeBytes * 0.9) / total));
                    await InstallBookAsync(book, tracks, missing, downloadProgress, cancellationToken);
                }
                foreach (var track in tracks)
                {
                    var oldName = track.AudioSha256 + ".mp3";
                    if (track.Playback != null && !_tracks.Values.Any(t => t.PlaybackFileName == oldName))
                    {
                        // Only obsolete app downloads, after verified replacement.
                        // The archival/pipeline recordings are outside this directory.
                        try { File.Delete(Path.Combine(DirectoryPath, oldName)); } catch (IOException) { /* A player can still be releasing the old download. */ }
                    }
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
        {
            directory = await _delivery.TryGetAssetPathAsync(book.PackName, cancellationToken);
        }
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
                await using (var file = File.Create(bundledCopy))
                {
                    await bundled.CopyToAsync(file, cancellationToken);
                }

                path = bundledCopy;
            }
            if (new FileInfo(path).Length != book.SizeBytes || !await MatchesHashAsync(path, book.Sha256, cancellationToken))
            {
                throw new InvalidDataException("Recording book package does not match this app release.");
            }
            using var zip = ZipFile.OpenRead(path);
            var expected = tracks.Select(t => t.PlaybackFileName).ToHashSet();
            if (zip.Entries.Count != expected.Count || !zip.Entries.Select(e => e.FullName).ToHashSet().SetEquals(expected))
            {
                throw new InvalidDataException("Unexpected or missing recordings in book package.");
            }
            foreach (var track in missing)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var destination = AudioPath(track);
                var temporary = destination + ".download";
                try
                {
                    await using var source = zip.GetEntry(track.PlaybackFileName)!.Open();
                    await using (var file = File.Create(temporary))
                    {
                        await source.CopyToAsync(file, cancellationToken);
                    }

                    if (!await MatchesHashAsync(temporary, track.PlaybackSha256, cancellationToken))
                    {
                        throw new InvalidDataException("Recording checksum mismatch.");
                    }
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
            var audio = AudioPath(track);
            if (!await MatchesHashAsync(audio, track.PlaybackSha256, cancellationToken))
            {
                throw new InvalidDataException("Download this book's recordings again in preferences.");
            }

            var cache = Path.Combine(_files.CacheDirectory, "recitation");
            Directory.CreateDirectory(cache);
            var chapter = Path.Combine(cache, "chapter-" + track.PlaybackSha256 + ".wav");
            foreach (var old in Directory.EnumerateFiles(cache, "*.wav"))
            {
                // A decoded chapter survives for instant replay; native players may
                // still finish releasing a previous file asynchronously.
                if (old != chapter)
                {
                    try { File.Delete(old); File.Delete(old + ".sha256"); } catch (IOException) { /* The native player can retain its last file until asynchronous release. */ }
                }
            }
            cancellationToken.ThrowIfCancellationRequested();
            if (intervals == null)
            {
                if (track.Playback == null || _playsOggNatively())
                {
                    // MediaElement demuxes MP3 everywhere and Ogg through ExoPlayer.
                    return audio;
                }

                // Apple's AVPlayer has no Ogg demuxer; decode the chapter once per source.
                if (decoder == null)
                {
                    throw new InvalidOperationException("A precise audio decoder is required.");
                }

                if (!await IsVerifiedChapterAsync(chapter, cancellationToken))
                {
                    var decoded = await decoder.CreateChapterAsync(audio, cancellationToken);
                    var temporary = chapter + ".download";
                    var temporaryDigest = temporary + ".sha256";
                    try
                    {
                        await File.WriteAllBytesAsync(temporary, decoded, cancellationToken);
                        if (!IsCompleteWav(temporary))
                        {
                            throw new InvalidDataException("Truncated decoded chapter.");
                        }
                        var digest = Convert.ToHexStringLower(SHA256.HashData(decoded));
                        await File.WriteAllTextAsync(temporaryDigest, digest, cancellationToken);
                        File.Move(temporary, chapter, true);
                        File.Move(temporaryDigest, chapter + ".sha256", true);
                    }
                    finally { File.Delete(temporary); File.Delete(temporaryDigest); }
                }
                return chapter;
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
                ? await decoder.CreateClipAsync(audio, intervals!, cancellationToken, pauseMs)
                : await decoder.CreateClipAsync(audio, intervals!, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            await File.WriteAllBytesAsync(clip, pcm, cancellationToken);
            return clip;
        }
        finally { _gate.Release(); }
    }

    private static async Task<bool> IsVerifiedChapterAsync(string path, CancellationToken cancellationToken)
    {
        try
        {
            if (!IsCompleteWav(path))
            {
                return false;
            }
            var expected = await File.ReadAllTextAsync(path + ".sha256", cancellationToken);
            return expected.Length == 64 && await MatchesHashAsync(path, expected, cancellationToken);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    // A damaged cached chapter must be decoded again from its verified source:
    // the RIFF header declares the complete payload length.
    private static bool IsCompleteWav(string path)
    {
        try
        {
            var length = new FileInfo(path).Length;
            if (length < 44)
            {
                return false;
            }

            Span<byte> header = stackalloc byte[12];
            using (var file = File.OpenRead(path))
            {
                file.ReadExactly(header);
            }
            return header[..4].SequenceEqual("RIFF"u8) && header[8..].SequenceEqual("WAVE"u8) &&
                BinaryPrimitives.ReadUInt32LittleEndian(header[4..8]) + 8L == length;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return false;
        }
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
