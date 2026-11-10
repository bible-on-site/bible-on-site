using System.Security.Cryptography;
using System.Text;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// The shared recitation engine's lifecycle: one surface seam drives the
/// player, the queue chains multi-perek clips, the cursor keeps its resume
/// semantics, and the audio lease tracks audibility — all without a real
/// MediaElement (#3260).
/// </summary>
public class ReaderRecitationEngineTests
{
    private static string Hash(byte[] value) => Convert.ToHexStringLower(SHA256.HashData(value));
    private static byte[] Wav(byte[] pcm)
    {
        var wav = new byte[44 + pcm.Length];
        "RIFF"u8.ToArray().CopyTo(wav, 0);
        BitConverter.GetBytes(36 + pcm.Length).CopyTo(wav, 4);
        "WAVE"u8.ToArray().CopyTo(wav, 8);
        "fmt "u8.ToArray().CopyTo(wav, 12);
        BitConverter.GetBytes(16).CopyTo(wav, 16);
        BitConverter.GetBytes((short)1).CopyTo(wav, 20);
        BitConverter.GetBytes((short)1).CopyTo(wav, 22);
        BitConverter.GetBytes(48000).CopyTo(wav, 24);
        BitConverter.GetBytes(96000).CopyTo(wav, 28);
        BitConverter.GetBytes((short)2).CopyTo(wav, 32);
        BitConverter.GetBytes((short)16).CopyTo(wav, 34);
        "data"u8.ToArray().CopyTo(wav, 36);
        BitConverter.GetBytes(pcm.Length).CopyTo(wav, 40);
        pcm.CopyTo(wav, 44);
        return wav;
    }

    private static List<Pasuk> Canonical() => [new() { PasukNum = 1, Text = "ברא אור", Segments = [
        new() { Type = SegmentType.Qri, Value = "ברא" }, new() { Type = SegmentType.Qri, Value = "אור" }] }];
    private static RecitationTrack Track(int id, byte[] audio, string status = "ready") => new(id,
        $"https://example.com/recordings/{id}_record.mp3", Hash(audio), Hash(Encoding.UTF8.GetBytes("1:1:ברא\n1:2:אור")),
        3000, status, status == "ready" ? [new(1, 1, "ברא", 100, 800), new(1, 2, "אור", 900, 1800)] : []);

    /// <summary>A playback-surface double: every engine call lands here.</summary>
    private sealed class FakeSurface : IRecitationPlaybackSurface
    {
        public bool Exists { get; set; } = true;
        public RecitationPlaybackState CurrentState { get; set; } = RecitationPlaybackState.Stopped;
        public TimeSpan Position { get; set; } = TimeSpan.Zero;
        public double Speed { get; set; }
        public double Volume { get; set; }
        public bool HasSource => SourcePathValue != null;
        public string? SourcePathValue { get; private set; }
        public int PlayCount { get; private set; }
        public int PauseCount { get; private set; }
        public int StopCount { get; private set; }
        public TimeSpan? LastSeek { get; private set; }
        public int Refreshes { get; private set; }

        public void SetSourcePath(string? path) => SourcePathValue = path;
        public void Play() { PlayCount++; CurrentState = RecitationPlaybackState.Playing; }
        public void Pause() { PauseCount++; CurrentState = RecitationPlaybackState.Paused; }
        public void Stop() { StopCount++; CurrentState = RecitationPlaybackState.Stopped; }
#pragma warning disable S1172 // Interface contract keeps the token; the fake resolves immediately.
        public Task SeekToAsync(TimeSpan position, CancellationToken cancellationToken)
#pragma warning restore S1172
        { LastSeek = position; Position = position; return Task.CompletedTask; }
        public void RefreshPosition() => Refreshes++;
        public void RaiseOpened() { Exists = true; MediaOpened?.Invoke(this, EventArgs.Empty); }
        public void RaiseEnded() => MediaEnded?.Invoke(this, EventArgs.Empty);
        public void RaiseFailed(string? message = "boom") => MediaFailed?.Invoke(this, message);
        public void RaiseState(RecitationPlaybackState state)
        { CurrentState = state; StateChanged?.Invoke(this, state); }

#pragma warning disable S3264 // Raised through the Raise* helpers; Codacy's per-file analysis misses them.
        public event EventHandler? MediaOpened;
        public event EventHandler? MediaEnded;
        public event EventHandler<string?>? MediaFailed;
        public event EventHandler<RecitationPlaybackState>? StateChanged;
#pragma warning restore S3264
    }

    private sealed class FakeTicker : IRecitationFrameTicker
    {
        public int Starts { get; private set; }
        public int Stops { get; private set; }
        public void Start() => Starts++;
        public void Stop() => Stops++;
    }

    private sealed class FakePlatform : PlaybackAudioOwnership.IPlatform
    {
        public int Activations { get; private set; }
        public int Deactivations { get; private set; }
        public void Activate() => Activations++;
        public void Deactivate() => Deactivations++;
    }

    private sealed class FakeDecoder : IRecitationAudioDecoder
    {
        public int ClipCalls { get; private set; }
        public int Releases { get; private set; }
        private Task<byte[]> Clip(string audio, CancellationToken cancellationToken)
        { ClipCalls++; cancellationToken.ThrowIfCancellationRequested(); return Task.FromResult(Wav(Encoding.UTF8.GetBytes(audio))); }
        public Task<byte[]> CreateClipAsync(string audio, double startMs, double endMs, CancellationToken cancellationToken)
        { _ = (startMs, endMs); return Clip(audio, cancellationToken); }
        public Task<byte[]> CreateClipAsync(string audio, IReadOnlyList<(double Start, double End)> ranges, CancellationToken cancellationToken)
        { _ = ranges; return Clip(audio, cancellationToken); }
        public Task<byte[]> CreateClipAsync(string audio, IReadOnlyList<(double Start, double End)> ranges, CancellationToken cancellationToken, double pauseMs)
        { _ = (ranges, pauseMs); return Clip(audio, cancellationToken); }
        public Task<byte[]> CreateChapterAsync(string audio, CancellationToken cancellationToken)
        { cancellationToken.ThrowIfCancellationRequested(); return Task.FromResult(Wav(Encoding.UTF8.GetBytes(audio))); }
        public Task ReleaseAsync() { Releases++; return Task.CompletedTask; }
    }

    private sealed class Rig : IAsyncDisposable
    {
        public TestStorage Storage { get; } = new();
        public PreferencesService Preferences { get; }
        public RecitationService Service { get; }
        public FakeSurface Surface { get; } = new();
        public FakeTicker Ticker { get; } = new();
        public FakePlatform Platform { get; } = new();
        public FakeDecoder Decoder { get; } = new();
        public List<(string Title, string Message)> Alerts { get; } = [];
        public ReaderRecitationEngine Engine { get; }
        public int DecoderFactoryCalls { get; private set; }

        public Rig(InMemoryPreferencesStorage prefs)
        {
            Preferences = PreferencesService.CreateForTesting(prefs);
            Preferences.Load();
            // Install one ready perek track: catalog drives IsInstalled/GetTrack,
            // the audio file at AudioPath drives HasAudio and the hash check.
            var audio = "approved audio"u8.ToArray();
            var track = Track(1, audio);
            var book = new RecitationBookPack(1, Hash("pack"u8.ToArray()), 4, [1]);
            var catalog = new RecitationExtensionCatalog(1, new RecitationPackage(1, [track]), [book]);
            Storage.PackageFiles[RecitationExtensionCatalog.FileName] =
                System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(catalog,
                    RecitationJsonContext.Default.RecitationExtensionCatalog);
            Service = new RecitationService(Storage.FileSystem.Object, new Mock<IPadDeliveryService>().Object);
            var recordingsDir = Path.Join(Storage.Root, "extensions", "recitation");
            Directory.CreateDirectory(recordingsDir);
            File.WriteAllBytes(Path.Join(recordingsDir, track.PlaybackFileName), audio);
            var ownership = new PlaybackAudioOwnership(Platform, TimeSpan.Zero);
            Engine = new ReaderRecitationEngine(
                Service, Preferences, ownership, new object(), Surface,
                () => { DecoderFactoryCalls++; return Decoder; },
                (_, _) => Ticker,
                (title, message, _) => { Alerts.Add((title, message)); return Task.CompletedTask; });
        }

        public async ValueTask DisposeAsync() => await Storage.DisposeAsync();
    }

    /// <summary>Bounded wait for fire-and-forget engine continuations (MediaEnded chaining).</summary>
    private static async Task WaitForAsync(Func<bool> condition)
    {
        for (var i = 0; i < 200 && !condition(); i++)
        {
            await Task.Delay(10, TestContext.Current.CancellationToken);
        }
    }

    private static RecitationSegment SegmentFor(int perekId = 1,
        IReadOnlyList<(double Start, double End)>? ranges = null) =>
        new(perekId, Canonical(), null, null, ranges);

    /// <summary>A clip with explicit intervals always goes through the decoder.</summary>
    private static RecitationSegment ClipFor(int perekId = 1) =>
        new(perekId, Canonical(), null, null, [(100, 800)]);

    private static async Task<Rig> StartedRig()
    {
        var rig = new Rig(new InMemoryPreferencesStorage());
        await rig.Service.UpdateAsync(TestContext.Current.CancellationToken);
        rig.Engine.Available.Should().BeTrue();
        rig.Service.HasAudio(1).Should().BeTrue();
        return rig;
    }

    [Fact]
    public async Task PlayClipAsync_PreparesSource_AndPlaysAfterOpened()
    {
        await using var rig = await StartedRig();

        // The default pause preference keeps the original recording's spacing,
        // so the unbounded chapter plays the source file itself — no decoder.
        await rig.Engine.PlayClipAsync("chapter:1", continuous: true, SegmentFor());
        rig.Decoder.ClipCalls.Should().Be(0);
        rig.Surface.SourcePathValue.Should().NotBeNull();
        rig.Surface.PlayCount.Should().Be(0);

        rig.Surface.RaiseOpened();

        rig.Surface.PlayCount.Should().Be(1);
        rig.Engine.Cursor.PlayingKey.Should().Be("chapter:1");
        rig.Engine.Busy.Should().BeFalse();
    }

    [Fact]
    public async Task PlayPlanAsync_MediaEnded_ChainsNextSegment()
    {
        await using var rig = await StartedRig();
        var segments = new[] { ClipFor(), ClipFor() };

        await rig.Engine.PlayPlanAsync("unit:1", continuous: true, segments);
        rig.Surface.RaiseOpened();
        rig.Surface.RaiseEnded();

        // The engine dequeues the second segment and prepares its clip — the
        // chain is fire-and-forget, so the decode lands a tick after MediaEnded.
        await WaitForAsync(() => rig.Decoder.ClipCalls >= 2 || rig.Alerts.Count > 0);
        rig.Decoder.ClipCalls.Should().Be(2);
        rig.Engine.Cursor.PlayingKey.Should().Be("unit:1");
    }

    [Fact]
    public async Task MediaEnded_LastSegment_EndsPlaybackAndClearsKey()
    {
        await using var rig = await StartedRig();

        await rig.Engine.PlayClipAsync("chapter:1", continuous: true, SegmentFor());
        rig.Surface.RaiseOpened();
        rig.Surface.RaiseEnded();

        rig.Engine.Cursor.PlayingKey.Should().BeNull();
    }

    [Fact]
    public async Task StopPlayback_ClearsSourceAndCursor()
    {
        await using var rig = await StartedRig();

        await rig.Engine.PlayClipAsync("chapter:1", continuous: true, SegmentFor());
        rig.Surface.RaiseOpened();
        rig.Engine.StopPlayback();

        rig.Surface.SourcePathValue.Should().BeNull();
        rig.Engine.Cursor.PlayingKey.Should().BeNull();
    }

    [Fact]
    public async Task WordPreview_IsNotBarIssued_ToggleDoesNothing()
    {
        await using var rig = await StartedRig();
        var word = rig.Service.GetTrack(1)!.Words[0];

        await rig.Engine.PlayClipAsync($"word:1:{word.Pasuk}:{word.Segment}", continuous: false,
            new RecitationSegment(1, Canonical(), word.StartMs, word.EndMs, null),
            resumeFromMs: word.StartMs);
        rig.Surface.RaiseOpened();

        rig.Engine.Cursor.BarIssued.Should().BeFalse();
        rig.Engine.ToggleBarPlayback().Should().BeFalse();
        rig.Surface.PauseCount.Should().Be(0);
        // ...but the tapped word still bookmarked the resume point.
        rig.Engine.Cursor.ResumePosition.Should().Be((1, word.StartMs!.Value));
    }

    [Fact]
    public async Task ContinuousPlay_ResumesAtTappedWordPosition()
    {
        await using var rig = await StartedRig();
        var word = rig.Service.GetTrack(1)!.Words[1]; // "אור" at 900-1800

        await rig.Engine.PlayClipAsync($"word:1:{word.Pasuk}:{word.Segment}", continuous: false,
            new RecitationSegment(1, Canonical(), word.StartMs, word.EndMs, null),
            resumeFromMs: word.StartMs);
        rig.Surface.RaiseOpened();

        // The bar's Play now starts continuous playback at the bookmark.
        await rig.Engine.PlayPlanAsync("chapter:1", continuous: true, [SegmentFor()]);
        rig.Surface.RaiseOpened();

        // The timeline maps source 900ms into the clip's verse-pause layout.
        rig.Surface.LastSeek.Should().NotBeNull();
        rig.Surface.PlayCount.Should().Be(2);
    }

    [Fact]
    public async Task PreferencesChanged_WhenDisabled_StopsPlaybackAndReleasesDecoder()
    {
        await using var rig = await StartedRig();
        await rig.Engine.PlayClipAsync("chapter:1", continuous: true, SegmentFor());
        rig.Surface.RaiseOpened();

        rig.Preferences.QriynotEnabled = false;
        rig.Engine.PreferencesChanged();

        rig.Engine.Cursor.PlayingKey.Should().BeNull();
        rig.Decoder.Releases.Should().Be(1);
    }

    [Fact]
    public async Task MediaFailed_StopAndAlert()
    {
        await using var rig = await StartedRig();
        await rig.Engine.PlayClipAsync("chapter:1", continuous: true, SegmentFor());
        rig.Surface.RaiseOpened();

        rig.Surface.RaiseFailed();

        rig.Engine.Cursor.PlayingKey.Should().BeNull();
        rig.Alerts.Should().ContainSingle();
    }

    [Fact]
    public async Task PlayingState_ActivatesTheSharedAudioLease()
    {
        await using var rig = await StartedRig();
        await rig.Engine.PlayClipAsync("chapter:1", continuous: true, SegmentFor());
        rig.Surface.RaiseOpened();

        rig.Surface.RaiseState(RecitationPlaybackState.Playing);
        rig.Platform.Activations.Should().BeGreaterThan(0);
        rig.Ticker.Starts.Should().BeGreaterThan(0); // highlight ticker while playing

        rig.Surface.RaiseState(RecitationPlaybackState.Paused);
        // The lease releases after the quiet delay — with a zero delay it deactivates once the task runs.
        await Task.Delay(50, TestContext.Current.CancellationToken);
        rig.Platform.Deactivations.Should().BeGreaterThan(0);
    }
}
