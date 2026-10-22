using System.Text.Json;
using BibleOnSite.Models;

namespace BibleOnSite.Services;

/// <summary>Use the website's pinned MPEG/Opus decoders; native playback receives exact PCM ranges.</summary>
public sealed class MpegRecitationAudioDecoder : IRecitationAudioDecoder
{
    private const int UploadChunk = 32768;
    private const int DownloadChunk = 262144;
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
        catch (Exception) { _initialized = false; }
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
        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var state = ParseResult(await view.EvaluateJavaScriptAsync("recitation.status()"));
            var status = state.RootElement.GetProperty("state").GetString();
            if (status == "ready")
            {
                return;
            }

            if (status == "error" || DateTime.UtcNow > deadline)
            { _source = null; throw new InvalidDataException("Recording could not be decoded."); }
            await Task.Delay(50, cancellationToken);
        }
    }

    private async Task<byte[]> ReadWaveAsync(string expression, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var result = ParseResult(await view.EvaluateJavaScriptAsync(expression));
        var length = result.RootElement.GetProperty("length").GetInt32();
        using var wave = new MemoryStream(length);
        for (var offset = 0; offset < length; offset += DownloadChunk)
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var chunk = ParseResult(await view.EvaluateJavaScriptAsync($"recitation.chunk({offset},{DownloadChunk})"));
            wave.Write(Convert.FromBase64String(chunk.RootElement.GetProperty("data").GetString()!));
        }
        if (wave.Length != length)
        {
            throw new InvalidDataException("Truncated decoded recording.");
        }

        return wave.ToArray();
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
