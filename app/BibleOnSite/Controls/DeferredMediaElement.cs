using BibleOnSite.Services;
using CommunityToolkit.Maui.Core;
using CommunityToolkit.Maui.Views;
using Fonts;

namespace BibleOnSite.Controls;

/// <summary>
/// A media surface that stays inert until the user asks for playback.
/// Constructing a MediaElement handler activates the platform audio session —
/// building one while an article merely scrolls into view would cut off music
/// playing in another app (#2642). The placeholder keeps the frame and play
/// affordance; the real player is created only by an explicit tap, and this
/// view then owns the session lifecycle for that player.
/// </summary>
public sealed class DeferredMediaElement : ContentView
{
    private readonly string _mediaUrl;
    private readonly bool _isVideo;
    private double _volume = 1;
    private PlaybackAudioOwnership.Lease? _audioLease;

    public DeferredMediaElement(string mediaUrl, bool isVideo)
        : this(mediaUrl, isVideo, 1)
    {
    }

    public DeferredMediaElement(string mediaUrl, bool isVideo, double volume)
    {
        _mediaUrl = mediaUrl;
        _isVideo = isVideo;
        _volume = volume;
        HeightRequest = isVideo ? 220 : 80;
        if (isVideo)
        {
            BackgroundColor = Colors.Black;
        }

        var play = new Button
        {
            AutomationId = isVideo ? "ArticleVideoPlay" : "ArticleAudioPlay",
            Text = FluentUI.play_circle_48_regular,
            FontFamily = "FluentIcons",
            FontSize = isVideo ? 48 : 30,
            BackgroundColor = Colors.Transparent,
            HorizontalOptions = LayoutOptions.Center,
            VerticalOptions = LayoutOptions.Center,
            Padding = 0,
        };
        if (isVideo)
        {
            play.TextColor = Colors.White;
        }
        else
        {
            play.SetDynamicResource(Button.TextColorProperty, "Primary");
        }
        SemanticProperties.SetDescription(play, isVideo ? "הפעלת הסרטון" : "השמעת השיעור");
        ToolTipProperties.SetText(play, isVideo ? "הפעלת הסרטון" : "השמעת השיעור");
        play.Clicked += (_, _) => BeginPlayback();
        Content = play;
    }

    /// <summary>The real player once playback was requested; null while idle.</summary>
    public MediaElement? Player { get; private set; }

    /// <summary>
    /// Playback volume for the wrapped player. Updating it before the player
    /// exists keeps the value for its eventual creation.
    /// </summary>
    public double Volume
    {
        get => _volume;
        set
        {
            _volume = value;
            if (Player is { } player)
            {
                player.Volume = value;
            }
        }
    }

    /// <summary>
    /// Tears the player down and gives audio ownership back immediately —
    /// before the toolkit handler disposes — so a still-playing surface does
    /// not keep external music paused past the page's lifetime.
    /// </summary>
    public void Release()
    {
        _audioLease?.Dispose();
        _audioLease = null;
        if (Player is { } player)
        {
            player.Stop();
            player.Handler?.DisconnectHandler();
            Player = null;
        }
    }

    private void BeginPlayback()
    {
        if (Player != null)
        {
            return;
        }

        _audioLease ??= PlaybackAudioOwnership.Shared.Track(this);
        // Claim before the handler exists: creating it already activates the
        // audio session, so a source that fails to open must still release it
        // — MediaFailed can fire without the player ever reaching Playing.
        _audioLease.Playing();
        try
        {
            var player = new MediaElement
            {
                Source = MediaSource.FromUri(_mediaUrl),
                ShouldAutoPlay = true,
                ShouldShowPlaybackControls = true,
                Volume = _volume,
            };
            if (_isVideo)
            {
                player.Aspect = Aspect.AspectFit;
                player.BackgroundColor = Colors.Black;
            }

            player.StateChanged += OnPlayerStateChanged;
            // iOS can leave CurrentState at Playing once an item finishes, so the
            // end/failure events mark the lease idle explicitly.
            player.MediaEnded += (_, _) => _audioLease?.Idle();
            player.MediaFailed += (_, _) => _audioLease?.Idle();
            Player = player;
            Content = player;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: a player that cannot be constructed releases the claim and leaves the play affordance usable
        catch (Exception ex) //NOSONAR — a player that cannot be constructed releases the claim and leaves the play affordance usable.
        {
            #pragma warning restore S2221
            Player = null;
            _audioLease?.Idle();
            System.Diagnostics.Debug.WriteLine($"Article media player: {ex.Message}");
        }
    }

    private void OnPlayerStateChanged(object? sender, MediaStateChangedEventArgs e)
    {
        if (e.NewState == MediaElementState.Playing)
        {
            _audioLease?.Playing();
        }
        else if (e.NewState is MediaElementState.Paused or MediaElementState.Stopped or
            MediaElementState.None or MediaElementState.Failed)
        {
            _audioLease?.Idle();
        }
    }
}
