using System.Text.Json;
using BibleOnSite.Models;

namespace BibleOnSite.Services;

/// <summary>Use the website's pinned MPEG/Opus decoders; native playback receives exact PCM ranges.</summary>
public sealed class MpegRecitationAudioDecoder : IRecitationAudioDecoder
{
    // Bridge roundtrips dominate transfer time; the payload per eval is cheap.
    private const int UploadChunk = 8388608;
    private const int DownloadChunk = 8388608;
    private const string NotifyPrefix = "recitation-status:";
    private readonly WebView view;
    public MpegRecitationAudioDecoder(WebView view)
    {
        this.view = view;
        view.HandlerChanged += (_, _) => { _source = null; _initialized = false; };
    }
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string? _source;
    private bool _initialized;

    public async Task ReleaseAsync()
    {
        await _gate.WaitAsync();
        try
        {
            _source = null;
            if (_initialized)
            {
                await view.EvaluateJavaScriptAsync("recitation.reset()");
            }
        }
        #pragma warning disable S2221 // Deliberate failure boundary: JS reset failure marks the decoder uninitialized so the next use retries
        catch (Exception) { _initialized = false; } //NOSONAR — JS reset failure marks the decoder uninitialized so the next use retries.
        #pragma warning restore S2221
        finally { _gate.Release(); }
    }

    public Task<byte[]> CreateClipAsync(string audio, IReadOnlyList<(double Start, double End)> ranges,
        CancellationToken cancellationToken) => CreateClipAsync(audio, ranges, cancellationToken, 0);

    public Task<byte[]> CreateClipAsync(string audio, IReadOnlyList<(double Start, double End)> ranges,
        CancellationToken cancellationToken, double pauseMs)
    {
        var json = JsonSerializer.Serialize(ranges.Select(r => new RecitationClipRange(r.Start, r.End)).ToList(),
            RecitationJsonContext.Default.ClipRanges);
        var pause = pauseMs.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return DecodeAsync(audio, $"recitation.clip({json},{pause})", cancellationToken);
    }

    public Task<byte[]> CreateChapterAsync(string audio, CancellationToken cancellationToken) =>
        DecodeAsync(audio, "recitation.chapter()", cancellationToken);

    private async Task<byte[]> DecodeAsync(string audio, string expression, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await EnsureInitializedAsync(cancellationToken);
            await EnsureSourceAsync(audio, cancellationToken);
            await WaitReadyAsync(cancellationToken);
            return await ReadWaveAsync(expression, cancellationToken);
        }
        finally { _gate.Release(); }
    }

    private async Task EnsureInitializedAsync(CancellationToken cancellationToken)
    {
        if (_initialized)
        {
            return;
        }

        using var input = await FileSystem.Current.OpenAppPackageFileAsync("recitation-audio.html");
        using var reader = new StreamReader(input);
        using var decoderInput = await FileSystem.Current.OpenAppPackageFileAsync("recitation-mpeg.min.js");
        using var decoderReader = new StreamReader(decoderInput);
        var decoderScript = await decoderReader.ReadToEndAsync(cancellationToken);
        var loaded = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        void Navigated(object? sender, WebNavigatedEventArgs e) => loaded.TrySetResult();
        view.Navigated += Navigated;
        try
        {
            var html = await reader.ReadToEndAsync(cancellationToken);
            view.Source = new HtmlWebViewSource { Html = html };
            await loaded.Task.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken);
            // Evaluate the trusted local asset directly. Its compressed WASM
            // string contains characters that HTML script parsing would alter.
            await view.EvaluateJavaScriptAsync(decoderScript);
            _initialized = true;
        }
        finally { view.Navigated -= Navigated; }
    }

    private async Task EnsureSourceAsync(string audio, CancellationToken cancellationToken)
    {
        if (_source == audio)
        {
            return;
        }

        var bytes = await File.ReadAllBytesAsync(audio, cancellationToken);
        var encoded = Convert.ToBase64String(bytes);
        await view.EvaluateJavaScriptAsync("recitation.begin()");
        for (var offset = 0; offset < encoded.Length; offset += UploadChunk)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await view.EvaluateJavaScriptAsync($"recitation.append({JsonSerializer.Serialize(encoded.Substring(offset, Math.Min(UploadChunk, encoded.Length - offset)), RecitationJsonContext.Default.String)})");
        }
        await view.EvaluateJavaScriptAsync("recitation.finish()");
        _source = audio;
    }

    private async Task WaitReadyAsync(CancellationToken cancellationToken)
    {
        // The decoder reports ready or error through a recitation-status
        // navigation that the Navigating handler cancels into a completed wait.
        var finished = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        void Navigating(object? sender, WebNavigatingEventArgs e)
        {
            if (e.Url.StartsWith(NotifyPrefix, StringComparison.Ordinal))
            {
                e.Cancel = true;
                finished.TrySetResult(e.Url[NotifyPrefix.Length..]);
            }
        }
        view.Navigating += Navigating;
        try
        {
            using var state = ParseResult(await view.EvaluateJavaScriptAsync("recitation.status()"));
            var status = state.RootElement.GetProperty("state").GetString();
            if (status != "ready" && status != "error")
            {
                try
                {
                    status = await finished.Task.WaitAsync(TimeSpan.FromSeconds(60), cancellationToken);
                }
                catch (TimeoutException)
                {
                    status = null;
                }
            }
            if (status != "ready")
            { _source = null; throw new InvalidDataException("Recording could not be decoded."); }
        }
        finally { view.Navigating -= Navigating; }
    }

    private async Task<byte[]> ReadWaveAsync(string expression, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var result = ParseResult(await view.EvaluateJavaScriptAsync(expression));
        var length = result.RootElement.GetProperty("length").GetInt32();
        var wave = new byte[length];
        var offset = 0;
        while (offset < length)
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var chunk = ParseResult(await view.EvaluateJavaScriptAsync($"recitation.chunk({offset},{DownloadChunk})"));
            var data = chunk.RootElement.GetProperty("data").GetString()!;
            if (!Convert.TryFromBase64String(data, wave.AsSpan(offset), out var written) || written == 0)
            {
                throw new InvalidDataException("Truncated decoded recording.");
            }
            offset += written;
        }
        return wave;
    }

    private static JsonDocument ParseResult(string value)
    {
        // MAUI handlers differ in whether a JavaScript string is JSON-quoted.
        for (var i = 0; i < 2 && value.StartsWith('"'); i++)
        {
            value = JsonSerializer.Deserialize(value, RecitationJsonContext.Default.String)!;
        }

        return JsonDocument.Parse(value);
    }
}
