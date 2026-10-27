using BibleOnSite.Behaviors;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using CommunityToolkit.Maui.Core;
using CommunityToolkit.Maui.Views;

namespace BibleOnSite.Pages;

#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class PerekPage
#pragma warning restore S2333
{
    private readonly DoubleTapTracker _doubleTap = new();
    private bool _chapterRecitationSelection;
    private Pasuk? _focusedPasuk;
    private CancellationTokenSource? _recitationRequest;
    private CancellationTokenSource? _headerPress;
    private bool _recitationBusy;
    private bool _playWhenOpened;
    // Playback identity, chapter-vs-preview distinction and the perek-scoped
    // resume bookmark live together so pause/stop/end stay consistent.
    private readonly RecitationPlaybackCursor _recitationCursor = new();
    private double? _pendingSeekMs;
    private int _recitationGeneration;
    private MpegRecitationAudioDecoder? _audioDecoder;
    private IDispatcherTimer? _recitationFrameTimer;
    private RecitationTimeline? _recitationTimeline;
    private Pasuk? _recitingPasuk;
    private RecitationWord? _recitingWord;
    private readonly Dictionary<int, Span> _focusedWordSpans = [];
    private PlaybackAudioOwnership.Lease? _audioLease;
    private MediaElement? RecitationPlayer => RecitationPlayerHost.Content as MediaElement;

    /// <summary>
    /// This page's claim on exclusive device audio (#2642). Creating the
    /// MediaElement handler already activates iOS's audio session, so the
    /// lease only marks when playback is actually audible, releases it once
    /// the player goes quiet, and re-claims before an explicit resume.
    /// </summary>
    private PlaybackAudioOwnership.Lease AudioLease => _audioLease ??= PlaybackAudioOwnership.Shared.Track(this);

    private MediaElement GetOrCreateRecitationPlayer() => (MediaElement)RecitationPlayerHost.GetOrCreatePlayer(() =>
    {
        var player = new MediaElement
        {
            AutomationId = "RecitationPlayer",
            ShouldAutoPlay = false,
            ShouldShowPlaybackControls = false,
        };
        player.MediaOpened += OnRecitationMediaOpened;
        player.MediaEnded += OnRecitationMediaEnded;
        player.MediaFailed += OnRecitationMediaFailed;
        player.StateChanged += OnRecitationStateChanged;
        return player;
    });
    /// <summary>
    /// Whether recitation playback is allowed on this device: the catalog is
    /// installed AND the global קריינות preference (העדפות → על הפרק, default
    /// on) is enabled. Off hides every headphones action and suppresses
    /// tap/focus-triggered playback consistently (#2472).
    /// </summary>
    private bool RecitationAvailable => RecitationService.Instance.IsInstalled && _viewModel.IsQriynotEnabled;

    private void SubscribeRecitation()
    {
        PreferencesService.Instance.PreferencesChanged += OnRecitationPreferencesChanged;
        RecitationService.Instance.Changed += OnRecitationPackageChanged;
        RecitationService.Instance.PlaybackStopRequested += OnPlaybackStopRequested;
    }

    private async Task InitializeRecitationAsync()
    {
        try { await RecitationService.Instance.InitializeAsync(); _viewModel.RefreshRecitationAvailability(); UpdateSelectionBar(); _ = RecitationService.Instance.RefreshIfStaleAsync(); }
        #pragma warning disable S2221 // Deliberate failure boundary: recitation-pack init is best-effort; availability simply stays off
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Recitation extension: {ex.Message}"); } //NOSONAR — recitation-pack init is best-effort; availability simply stays off.
        #pragma warning restore S2221
    }

    private void OnRecitationPreferencesChanged(object? sender, EventArgs e)
    {
        if (!RecitationAvailable)
        {
            StopRecitation();
        }

        if (!RecitationAvailable && _audioDecoder != null)
        {
            _ = _audioDecoder.ReleaseAsync();
        }

        if (!RecitationAvailable && _chapterRecitationSelection)
        {
            _chapterRecitationSelection = false;
        }

        // The שמע/קריינות sliders update an in-flight playback, not only the next play.
        var preferences = PreferencesService.Instance;
        if (RecitationPlayer is { } player)
        {
            player.Volume = preferences.RecitationVolume;
            player.Speed = preferences.RecitationSpeed;
        }

        RefreshFocusedRecitation();
        UpdateSelectionBar();
    }

    private void OnRecitationPackageChanged(object? sender, EventArgs e) => Dispatcher.Dispatch(() =>
    {
        _viewModel.RefreshRecitationAvailability(); RefreshFocusedRecitation(); UpdateSelectionBar();
    });
    private void OnPlaybackStopRequested(object? sender, EventArgs e) => Dispatcher.Dispatch(() => { StopRecitation(); UpdateSelectionBar(); });

    private void StopRecitation()
    {
        ClearRecitationHighlight();
        // Invalidates any MediaOpened handler still awaiting its seek.
        _recitationGeneration++;
        _recitationRequest?.Cancel();
        _playWhenOpened = false;
        _recitationCursor.Stop();
        _pendingSeekMs = null;
        _recitationBusy = false;
        if (RecitationPlayer is { } player)
        {
            if (player.Source != null) { player.Stop(); }
            player.Source = null;
        }
        _audioLease?.Idle();
    }

    /// <summary>
    /// Re-claims device audio before the platform player resumes — a pause may
    /// already have released the session, and the toolkit only activates it at
    /// handler creation (#2642).
    /// </summary>
    private void ResumeRecitationPlayback(MediaElement player)
    {
        AudioLease.Playing();
        player.Play();
    }

    private void ClearRecitationHighlight()
    {
        _recitationFrameTimer?.Stop();
        _recitationTimeline = null;
        SetRecitingWord(null);
    }

    private void SetRecitingWord(RecitationWord? word)
    {
        if (_recitingWord == word)
        {
            return;
        }

        var nextPasuk = word == null ? null : _viewModel.Perek?.Pasukim.FirstOrDefault(p => p.PasukNum == word.Pasuk);
        if (_recitingPasuk != null && _recitingPasuk != nextPasuk)
        {
            _recitingPasuk.RecitingSegment = null;
        }
        if (_recitingWord != null && _focusedPasuk?.PasukNum == _recitingWord.Pasuk &&
            _focusedWordSpans.TryGetValue(_recitingWord.Segment, out var previous))
        {
            previous.BackgroundColor = null;
            previous.TextColor = Pasuk.QriTextColor;
        }

        _recitingWord = word;
        _recitingPasuk = nextPasuk;
        if (_recitingPasuk != null)
        {
            _recitingPasuk.RecitingSegment = word!.Segment;
        }
        if (word != null && _focusedPasuk?.PasukNum == word.Pasuk && _focusedWordSpans.TryGetValue(word.Segment, out var current))
        {
            current.BackgroundColor = Pasuk.RecitingBackgroundDefault;
            current.TextColor = Pasuk.RecitingText;
        }
    }

    private void UpdateRecitationHighlight(object? sender, EventArgs e)
    {
        if (_recitationCursor.PlayingKey == null || RecitationPlayer is not { } player || player.CurrentState != MediaElementState.Playing)
        {
            return;
        }

        // Refresh the platform player's reported position before painting the word.
        player.Handler?.Invoke("StatusUpdated", null);
        SetRecitingWord(_recitationTimeline?.WordAt(player.Position.TotalMilliseconds));
    }

    private void ResetRecitationContext() => ResetRecitationContext(stopPlayback: true);

    private void ResetRecitationContext(bool stopPlayback)
    {
        if (stopPlayback)
        {
            StopRecitation();
        }
        _doubleTap.Reset();
        _headerPress?.Cancel();
        _chapterRecitationSelection = false;
        _focusedPasuk = null;
        _focusedWordSpans.Clear();
        FocusedPasukOverlay.IsVisible = false;
        FocusedPasukOverlay.PerushimSource = null;
        PerekCarousel.InputTransparent = false;
        AutomationProperties.SetExcludedWithChildren(PerekCarousel, false);
        if (_audioDecoder != null)
        {
            _ = _audioDecoder.ReleaseAsync();
        }
    }

    /// <summary>
    /// Perek changes and page exits also drop the continuous-playback resume
    /// position; opening or closing the focused pasuk keeps it.
    /// </summary>
    private void ResetRecitationSession()
    {
        ResetRecitationContext();
        _recitationCursor.Reset();
        // Leaving the reader or switching perek drops the audio claim at once
        // — a hidden player must not keep external music paused (#2642).
        _audioLease?.Dispose();
        _audioLease = null;
    }

    private void OnHeaderLongPressed(object? sender, EventArgs e)
    {
        if (!RecitationAvailable || sender is not LongPressBehavior behavior ||
            behavior.AssociatedView?.BindingContext is not Perek perek || perek != _viewModel.Perek)
        {
            return;
        }

        EnterChapterRecitation();
    }

    private void EnterChapterRecitation()
    {
        ResetRecitationContext();
        _viewModel.ClearSelected();
        _chapterRecitationSelection = true;
        _lastLongPressTime = DateTime.Now;
        UpdateSelectionBar();
        TriggerHapticFeedback();
    }

    private async void OnHeaderPointerPressed(object? sender, PointerEventArgs e)
    {
        if (OperatingSystem.IsAndroid() || OperatingSystem.IsIOS() || OperatingSystem.IsMacCatalyst() || !RecitationAvailable)
        {
            return;
        }

        _headerPress?.Cancel();
        using var request = new CancellationTokenSource();
        _headerPress = request;
        var perek = (sender as Label)?.BindingContext as Perek;
        try
        {
            await Task.Delay(600, request.Token);
            if (perek != null && perek == _viewModel.Perek)
            {
                EnterChapterRecitation();
            }
        }
        catch (OperationCanceledException) { /* Release, movement, or navigation cancels the pending long press. */ }
        finally
        {
            if (_headerPress == request)
            {
                _headerPress = null;
            }
        }
    }
    private void OnHeaderPointerReleased(object? sender, PointerEventArgs e) => _headerPress?.Cancel();
    private void OnHeaderPointerMoved(object? sender, PointerEventArgs e) => _headerPress?.Cancel();

    private async Task HandlePasukTapAsync(Pasuk pasuk)
    {
        if (_viewModel.SelectedPasukNums.Count > 0)
        {
            // Toggling a pasuk in selection mode must not stop playback or the
            // moving word marker (#2473); the selection bar stays the pause surface.
            _doubleTap.Reset();
            _viewModel.ToggleSelectedPasuk(pasuk.PasukNum);
            UpdatePasukSelection();
            return;
        }
        var doubled = _doubleTap.Tap(_viewModel.PerekId, pasuk.PasukNum, Environment.TickCount64);
        if (!doubled)
        {
            // קריינות: a single tap plays just this pasuk; a double tap still
            // reaches the focused-pasuk view on the second Tap() call.
            if (CanPlayPasukOnTap)
            {
                await PlayPasukRecitationAsync(pasuk);
            }
            return;
        }

        await OpenFocusedPasukAsync(pasuk);
    }

    /// <summary>
    /// Single-tap pasuk playback applies only while קריינות is checked and the
    /// currently displayed perek has downloaded audio.
    /// </summary>
    private bool CanPlayPasukOnTap => _viewModel.IsQriynotEnabled &&
        _viewModel.Perek is { } perek && RecitationService.Instance.HasAudio(perek.PerekId);

    /// <summary>
    /// Plays exactly one pasuk by bounding the track to its word timings.
    /// Requires an aligned ("ready") track — without word timings there is no
    /// pasuk boundary to stop at.
    /// </summary>
    private async Task PlayPasukRecitationAsync(Pasuk pasuk)
    {
        if (_viewModel.Perek is not { } perek)
        {
            return;
        }

        var track = RecitationService.Instance.GetTrack(perek.PerekId);
        if (track?.AlignmentStatus != "ready")
        {
            // Without aligned word timings a pasuk has no playback boundary —
            // the controls already show word/verse recitation unavailable, so
            // the tap does nothing. A missing track is real missing audio and
            // still reports.
            if (track == null)
            {
                await ShellAppNavigator.Instance.DisplayAlertAsync("הקראה", "אין הקלטה לפרק זה", "אישור");
            }
            return;
        }

        var words = track.Words.Where(w => w.Pasuk == pasuk.PasukNum).ToList();
        if (words.Count == 0 || words[0].StartMs == null || words[^1].EndMs == null)
        {
            // A "ready" track missing this pasuk's timings is corrupt pack
            // data — a real failure, reported like other playback failures.
            await ShellAppNavigator.Instance.DisplayAlertAsync("הקראה", "לא ניתן להשמיע את ההקלטה. בדקו את חבילת ההקראה בהעדפות.", "אישור");
            return;
        }

        // Tapping the playing pasuk again goes through the shared toggle; the
        // second tap of a double-tap opens the focused pasuk and keeps it.
        await PlayRecitationAsync($"pasuk:{perek.PerekId}:{pasuk.PasukNum}",
            ranges: [(words[0].StartMs!.Value, words[^1].EndMs!.Value)],
            resumeFromMs: words[0].StartMs!.Value);
    }

    private async void OnPasukDoubleTapped(object? sender, TappedEventArgs e)
    {
#if !ANDROID
        if (_viewModel.SelectedPasukNums.Count == 0 && e.Parameter is int number &&
            _viewModel.Perek?.Pasukim.FirstOrDefault(p => p.PasukNum == number) is { } pasuk)
        {
            await OpenFocusedPasukAsync(pasuk);
        }
#else
        await Task.CompletedTask;
#endif
    }

    private async Task OpenFocusedPasukAsync(Pasuk pasuk)
    {
        if (_focusedPasuk == pasuk)
        {
            return;
        }

        // A pasuk preview that is still playing keeps playing into the focused
        // view — its words highlight there live and the bar can pause it.
        ResetRecitationContext(stopPlayback: false);
        _focusedPasuk = pasuk;
        // A double tap's first press paused this pasuk's preview through the
        // shared toggle — opening its focused view resumes it so the clip does
        // not sit silently paused.
        if (RecitationPlayer is { } focusedPlayer &&
            _recitationCursor.ResumesOnPasukFocus(_viewModel.PerekId, pasuk.PasukNum,
                focusedPlayer.CurrentState == MediaElementState.Playing))
        {
            ResumeRecitationPlayback(focusedPlayer);
        }
        // The full pasuk source lives in the shared toolbar title, set by
        // UpdateSelectionBar below (#2466).
        // Opening the focused pasuk plays it (#2472). An in-flight clip for
        // this same pasuk continues/resumes untouched — one deliberate open
        // issues at most one playback request.
        else if (RecitationAvailable &&
            _recitationCursor.PlayingKey != $"pasuk:{_viewModel.PerekId}:{pasuk.PasukNum}" &&
            CanPlayWholePasuk(pasuk))
        {
            _ = PlayPasukRecitationAsync(pasuk);
        }
        FocusedPasukOverlay.SourceText = $"{_viewModel.Source} {pasuk.PasukNumHeb}";
        FocusedPasukOverlay.IsVisible = true;
        PerekCarousel.InputTransparent = true;
        AutomationProperties.SetExcludedWithChildren(PerekCarousel, true);
        RefreshFocusedRecitation();
        FocusedPasukOverlay.PerushimSource = _viewModel.GetPerushimForPasuk(pasuk.PasukNum);
        UpdateSelectionBar();
        try
        {
            var perekId = _viewModel.PerekId;
            await _viewModel.LoadPerushimAsync(perekId);
            if (_focusedPasuk == pasuk && _viewModel.PerekId == perekId)
            {
                FocusedPasukOverlay.PerushimSource = _viewModel.GetPerushimForPasuk(pasuk.PasukNum);
            }
        }
        #pragma warning disable S2221 // Deliberate failure boundary: focused-commentary refresh is best-effort
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Focused commentaries: {ex.Message}"); } //NOSONAR — focused-commentary refresh is best-effort.
        #pragma warning restore S2221
    }

    /// <summary>
    /// The focused-view headphones action plays the whole pasuk — offered while
    /// קריינות is enabled and this pasuk's timings are ready.
    /// </summary>
    private bool CanPlayWholePasuk(Pasuk pasuk) => RecitationAvailable &&
        _viewModel.Perek is { } perek &&
        RecitationService.Instance.GetTrack(perek.PerekId) is { AlignmentStatus: "ready" } track &&
        track.Matches(perek.Pasukim) &&
        track.Words.Any(w => w.Pasuk == pasuk.PasukNum && w.StartMs != null && w.EndMs != null);

    private async void OnFocusedPlayClicked(object? sender, EventArgs e)
    {
        if (_focusedPasuk is { } pasuk)
        {
            await PlayPasukRecitationAsync(pasuk);
        }
    }

    private void RefreshFocusedRecitation()
    {
        _focusedWordSpans.Clear();
        if (_focusedPasuk is not { } pasuk || _viewModel.Perek is not { } perek)
        {
            FocusedPasukOverlay.PlayButtonVisible = false;
            return;
        }

        FocusedPasukOverlay.PlayButtonVisible = RecitationAvailable;
        FocusedPasukOverlay.PlayButtonEnabled = CanPlayWholePasuk(pasuk);
        var track = RecitationService.Instance.GetTrack(perek.PerekId);
        var canPlayWords = RecitationAvailable && RecitationService.Instance.HasAudio(perek.PerekId) &&
            track?.AlignmentStatus == "ready" && track.Matches(perek.Pasukim);
        FocusedPasukOverlay.HintText = canPlayWords ? "הקישו על מילה כדי לשמוע אותה." : "";
        if (!canPlayWords) { FocusedPasukOverlay.PasukText.FormattedText = pasuk.FormattedText; return; }
        var formatted = new FormattedString();
        for (var i = 0; i < pasuk.Segments.Count; i++)
        {
            var segment = pasuk.Segments[i];
            if (segment.IsQriDifferentThanKtiv)
            {
                formatted.Spans.Add(new Span { Text = "(קְרִי: ", TextColor = Pasuk.QriTextColor });
            }

            var span = new Span
            {
                Text = segment.Type switch
                {
                    SegmentType.Ptuha => " {פ} ",
                    SegmentType.Stuma => " {ס} ",
                    // Display masking only — word/segment indices stay canonical
                    // so tapped-word recitation keeps its timing alignment.
                    // MaskText (not MaskValue): a bracketed qri holds several words.
                    _ => DivineNameMasking.MaskText(segment.Value)
                }
            };
            var word = track!.Words.FirstOrDefault(w => w.Pasuk == pasuk.PasukNum && w.Segment == i + 1);
            if (word != null)
            {
                _focusedWordSpans[word.Segment] = span;
                var reciting = _recitingWord == word;
                span.TextColor = reciting ? Pasuk.RecitingText : Pasuk.QriTextColor;
                span.BackgroundColor = reciting ? Pasuk.RecitingBackgroundDefault : null;
                var tap = new TapGestureRecognizer();
                tap.Tapped += async (_, _) => await PlayRecitationAsync($"word:{perek.PerekId}:{word.Pasuk}:{word.Segment}",
                    word.StartMs, word.EndMs, resumeFromMs: word.StartMs);
                span.GestureRecognizers.Add(tap);
            }
            formatted.Spans.Add(span);
            if (segment.IsQriDifferentThanKtiv)
            {
                formatted.Spans.Add(new Span { Text = ")", TextColor = Pasuk.QriTextColor });
            }

            if (i < pasuk.Segments.Count - 1 && segment.Type is not (SegmentType.Ptuha or SegmentType.Stuma) && !segment.EndsWithMaqaf)
            {
                formatted.Spans.Add(new Span { Text = " " });
            }
        }
        FocusedPasukOverlay.PasukText.FormattedText = formatted;
    }

    private async void OnSelectionRecitationClicked(object? sender, EventArgs e)
    {
        // Playback the recitation controls themselves issued (the chapter, a
        // verses range, or a pasuk preview) toggles pause and resume — a tapped
        // word preview is a bookmark, not the bar's playback (#2157), so Play
        // during one starts continuous playback at that word instead.
        if (_recitationCursor.BarIssued && RecitationPlayer is { } player && player.CurrentState is MediaElementState.Playing or MediaElementState.Paused)
        {
            if (player.CurrentState == MediaElementState.Playing)
            {
                player.Pause();
            }
            else
            {
                ResumeRecitationPlayback(player);
            }

            return;
        }
        if (_viewModel.Perek is not { } perek)
        {
            return;
        }

        var track = RecitationService.Instance.GetTrack(perek.PerekId);
        var numbers = _focusedPasuk != null ? new[] { _focusedPasuk.PasukNum } : _viewModel.SelectedPasukNums.Order().ToArray();
        // With nothing selected the Play button means the chapter — a bookmarked
        // word or pasuk resumes there instead of restarting the perek (#2157).
        if (_chapterRecitationSelection || _recitationCursor.PlayingKey != null || numbers.Length == 0)
        {
            await PlayRecitationAsync($"chapter:{perek.PerekId}");
            return;
        }
        if (track?.AlignmentStatus != "ready")
        {
            return;
        }

        var ranges = numbers.Select(n => track.Words.Where(w => w.Pasuk == n).ToList()).ToList();
        if (ranges.Any(r => r.Count == 0))
        {
            return;
        }

        await PlayRecitationAsync($"verses:{perek.PerekId}:{string.Join(',', numbers)}", ranges: ranges.Select(r => (r[0].StartMs!.Value, r[^1].EndMs!.Value)).ToList());
    }

    private async Task PlayRecitationAsync(string key, double? start = null, double? end = null,
        IReadOnlyList<(double Start, double End)>? ranges = null, double? resumeFromMs = null)
    {
        if (!RecitationAvailable || _viewModel.Perek is not { } perek)
        {
            return;
        }

        // A tapped word or pasuk marks where the next continuous playback resumes.
        // It is set on request so pressing Play before the preview finishes still
        // resumes there, and it outlives the preview's own stop/reset.
        if (resumeFromMs is double resume)
        {
            _recitationCursor.MarkResume(perek.PerekId, resume);
        }
        var continuous = start == null && ranges == null;

        if (_recitationCursor.PlayingKey == key && RecitationPlayer is { } existing && existing.CurrentState is MediaElementState.Playing or MediaElementState.Paused)
        {
            if (existing.CurrentState == MediaElementState.Playing)
            {
                existing.Pause();
            }
            else
            {
                ResumeRecitationPlayback(existing);
            }

            return;
        }
        // Keep the claim across the deliberate gap — stopping the old clip,
        // decoding and opening the new one run through silent player states
        // on the way back to Playing (#2642).
        using var audioHold = AudioLease.Hold();
        StopRecitation();
        using var request = new CancellationTokenSource();
        _recitationRequest = request;
        _recitationBusy = true;
        UpdateSelectionBar();
        try
        {
            var preferences = PreferencesService.Instance;
            var track = RecitationService.Instance.GetTrack(perek.PerekId);
            if (ranges == null && start == null && preferences.RecitationVersePauseMs >= 0 && track?.AlignmentStatus == "ready")
            {
                ranges = track.Words.GroupBy(w => w.Pasuk).OrderBy(g => g.Key)
                    .Select(g => (g.First().StartMs!.Value, g.Last().EndMs!.Value)).ToList();
            }
            // MediaElement's position is in source time; scale generated silence so
            // the user's pause retains its wall-clock length at every speed.
            var pauseMs = ranges is { Count: > 1 } && preferences.RecitationVersePauseMs >= 0
                ? preferences.RecitationVersePauseMs * preferences.RecitationSpeed : 0;
            _audioDecoder ??= new MpegRecitationAudioDecoder(RecitationDecoder.GetOrCreateView());
            var path = await RecitationService.Instance.PrepareAudioAsync(perek.PerekId, perek.Pasukim, start, end, request.Token, ranges, _audioDecoder, pauseMs);
            if (request.IsCancellationRequested || _viewModel.Perek != perek || !RecitationAvailable)
            {
                return;
            }

            _recitationCursor.Begin(key, continuous);
            _recitationTimeline = track?.AlignmentStatus == "ready"
                ? new RecitationTimeline(track, ranges ?? (start.HasValue && end.HasValue ? [(start.Value, end.Value)] : null), pauseMs) : null;
            // The timeline maps the tapped-word resume point into this clip's position.
            _pendingSeekMs = _recitationCursor.PendingSeekFor(perek.PerekId, continuous, _recitationTimeline);
            // Claim before the handler attaches: creating it already activates
            // the session, so a source that fails to open must still release it
            // — MediaFailed can fire without the player ever reaching Playing.
            AudioLease.Playing();
            var player = GetOrCreateRecitationPlayer();
            player.Speed = preferences.RecitationSpeed;
            player.Volume = preferences.RecitationVolume;
            _playWhenOpened = true;
            player.Source = MediaSource.FromFile(path);
        }
        catch (OperationCanceledException) { /* Navigation or another selection cancels the old request. */ }
        #pragma warning disable S2221 // Deliberate failure boundary: playback failure shows the user alert unless the request was canceled
        catch (Exception ex) //NOSONAR — playback failure shows the user alert unless the request was canceled.
        {
            #pragma warning restore S2221
            _audioLease?.Idle();
            System.Diagnostics.Debug.WriteLine($"Recitation playback: {ex}");
            if (!request.IsCancellationRequested)
            {
                await ShellAppNavigator.Instance.DisplayAlertAsync("הקראה", "לא ניתן להשמיע את ההקלטה. בדקו את חבילת ההקראה בהעדפות.", "אישור");
            }
        }
        finally
        {
            if (_recitationRequest == request) { _recitationRequest = null; _recitationBusy = false; UpdateSelectionBar(); }
        }
    }

    private async void OnRecitationMediaOpened(object? sender, EventArgs e)
    {
        if (!_playWhenOpened || !RecitationAvailable || sender is not MediaElement player)
        {
            return;
        }

        _playWhenOpened = false;
        var generation = _recitationGeneration;
        if (_pendingSeekMs is double seekMs)
        {
            _pendingSeekMs = null;
            try
            {
                // Resume continuous playback from the tapped word's position.
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await player.SeekTo(TimeSpan.FromMilliseconds(seekMs), timeout.Token);
            }
            catch (Exception ex) //NOSONAR — a platform that cannot seek here still plays from the start.
            {
                System.Diagnostics.Debug.WriteLine($"Recitation resume: {ex.Message}");
            }
        }
        if (generation != _recitationGeneration)
        {
            // StopRecitation ran during the seek — do not revive the old source.
            return;
        }
        ResumeRecitationPlayback(player);
    }
    private void OnRecitationMediaEnded(object? sender, EventArgs e)
    {
        // iOS can keep CurrentState at Playing once an item finishes, so the
        // end event releases the audio claim itself (#2642).
        _audioLease?.Idle();
        // A completed chapter consumes the resume bookmark; a finished preview keeps it.
        _recitationCursor.End();
        ClearRecitationHighlight();
        UpdateSelectionBar();
    }
    private void OnRecitationStateChanged(object? sender, MediaStateChangedEventArgs e)
    {
        // The lease follows audible states only — buffering/opening keep the
        // claim so intentional gaps don't churn the session (#2642).
        if (e.NewState == MediaElementState.Playing)
        {
            AudioLease.Playing();
        }
        else if (e.NewState is MediaElementState.Paused or MediaElementState.Stopped or
            MediaElementState.None or MediaElementState.Failed)
        {
            _audioLease?.Idle();
        }
        _recitationFrameTimer?.Stop();
        if (_recitationCursor.PlayingKey != null && _recitationTimeline != null && RecitationPlayer?.CurrentState == MediaElementState.Playing)
        {
            if (_recitationFrameTimer == null)
            {
                _recitationFrameTimer = Dispatcher.CreateTimer();
                _recitationFrameTimer.Interval = TimeSpan.FromMilliseconds(25);
                _recitationFrameTimer.Tick += UpdateRecitationHighlight;
            }
            UpdateRecitationHighlight(this, EventArgs.Empty);
            _recitationFrameTimer.Start();
        }
        else if (RecitationPlayer?.CurrentState is MediaElementState.Stopped or MediaElementState.None or MediaElementState.Failed)
        {
            SetRecitingWord(null);
        }
        UpdateSelectionBar();
    }
    private async void OnRecitationMediaFailed(object? sender, MediaFailedEventArgs e)
    {
        if (_recitationCursor.PlayingKey == null)
        {
            return;
        }

        StopRecitation(); UpdateSelectionBar();
        await ShellAppNavigator.Instance.DisplayAlertAsync("הקראה", "לא ניתן להשמיע את ההקלטה במכשיר זה.", "אישור");
    }

    protected override bool OnBackButtonPressed()
    {
        return TryHandleReaderBack() || base.OnBackButtonPressed();
    }

    private bool TryHandleReaderBack()
    {
        if (ExitFullScreenButton.IsVisible)
        { ExitFullScreen(); return true; }
        if (ReaderMenuOverlay.IsOpen)
        { ReaderMenuOverlay.Close(); return true; }
        if (ChapterSearch.IsSearchOpen) { ChapterSearch.HandleBack(); return true; }
        // Whatever keeps the selection bar up also owns Back — including a clip
        // playing with nothing selected, which stops instead of navigating.
        if (ReaderSurfaceState.IsActive(_viewModel.SelectedPasukNums.Count, _chapterRecitationSelection,
                _focusedPasuk != null, _recitationCursor.PlayingKey != null))
        { ClearAllSelections(); return true; }
        return false;
    }
}
