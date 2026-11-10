using BibleOnSite.Helpers;
using CommunityToolkit.Maui.Core;
using CommunityToolkit.Maui.Views;

namespace BibleOnSite.Controls;

/// <summary>
/// Adapts a reader's lazily-created <see cref="MediaElement"/> (hosted inside
/// a <see cref="RecitationPlaybackHost"/>) to the engine's
/// <see cref="IRecitationPlaybackSurface"/> seam. The player only
/// materializes when the engine actually needs it — <see cref="Exists"/> and
/// the state accessors never create the handler, keeping the audio session
/// off while browsing (#2642).
/// </summary>
public sealed class MediaElementRecitationSurface : IRecitationPlaybackSurface
{
    private readonly RecitationPlaybackHost _host;
    private readonly string _automationId;
    private MediaElement? _player;

    public MediaElementRecitationSurface(RecitationPlaybackHost host) : this(host, "RecitationPlayer")
    {
    }

    public MediaElementRecitationSurface(RecitationPlaybackHost host, string automationId)
    {
        _host = host;
        _automationId = automationId;
    }

    private MediaElement GetOrCreate() => _player ??= (MediaElement)_host.GetOrCreatePlayer(() =>
    {
        var player = new MediaElement
        {
            AutomationId = _automationId,
            ShouldAutoPlay = false,
            ShouldShowPlaybackControls = false,
        };
        player.MediaOpened += (s, e) => MediaOpened?.Invoke(s, e);
        player.MediaEnded += (s, e) => MediaEnded?.Invoke(s, e);
        player.MediaFailed += (s, e) => MediaFailed?.Invoke(s, e is MediaFailedEventArgs args ? args.ErrorMessage : null);
        player.StateChanged += (s, e) => StateChanged?.Invoke(s,
            e is MediaStateChangedEventArgs args ? Map(args.NewState) : RecitationPlaybackState.None);
        return player;
    });

    /// <summary>Only this surface creates the player, so a cached reference means the handler exists.</summary>
    public bool Exists => _player != null;

    public RecitationPlaybackState CurrentState =>
        _player is { } player ? Map(player.CurrentState) : RecitationPlaybackState.None;

    public TimeSpan Position => _player?.Position ?? TimeSpan.Zero;

    public double Speed { get => GetOrCreate().Speed; set => GetOrCreate().Speed = value; }
    public double Volume { get => GetOrCreate().Volume; set => GetOrCreate().Volume = value; }

    public bool HasSource => _player?.Source != null;

    public void SetSourcePath(string? path) =>
        GetOrCreate().Source = path == null ? null : MediaSource.FromFile(path);

    public void Play() => GetOrCreate().Play();
    public void Pause() => _player?.Pause();
    public void Stop() => _player?.Stop();

    public async Task SeekToAsync(TimeSpan position, CancellationToken cancellationToken)
    {
        if (_player != null)
        {
            await _player.SeekTo(position, cancellationToken);
        }
    }

    /// <summary>Pumps the platform player's reported position before the word marker is painted.</summary>
    public void RefreshPosition() => _player?.Handler?.Invoke("StatusUpdated", null);

#pragma warning disable S3264 // Invoked inside GetOrCreate's subscriptions; subscribers are the engine — Codacy's per-file analysis misses them.
    public event EventHandler? MediaOpened;
    public event EventHandler? MediaEnded;
    public event EventHandler<string?>? MediaFailed;
    public event EventHandler<RecitationPlaybackState>? StateChanged;
#pragma warning restore S3264

    private static RecitationPlaybackState Map(MediaElementState state) => state switch
    {
        MediaElementState.Opening => RecitationPlaybackState.Opening,
        MediaElementState.Buffering => RecitationPlaybackState.Buffering,
        MediaElementState.Playing => RecitationPlaybackState.Playing,
        MediaElementState.Paused => RecitationPlaybackState.Paused,
        MediaElementState.Stopped => RecitationPlaybackState.Stopped,
        MediaElementState.Failed => RecitationPlaybackState.Failed,
        _ => RecitationPlaybackState.None,
    };
}
