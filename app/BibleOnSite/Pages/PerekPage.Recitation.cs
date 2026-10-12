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
    private string? _playingKey;
    private bool _playingContinuous;
    // The last tapped word or pasuk marks where continuous playback resumes, in
    // recording milliseconds. Keyed by perek so a stale position can never leak
    // into another perek's recording.
    private (int PerekId, double StartMs)? _resumePosition;
    private double? _pendingSeekMs;
    private int _recitationGeneration;
    private MpegRecitationAudioDecoder? _audioDecoder;
    private IDispatcherTimer? _recitationFrameTimer;
    private RecitationTimeline? _recitationTimeline;
    private Pasuk? _recitingPasuk;
    private RecitationWord? _recitingWord;
    private readonly Dictionary<int, Span> _focusedWordSpans = [];
    private bool RecitationEnabled => PreferencesService.Instance.RecitationEnabled && RecitationService.Instance.IsInstalled;

    private void SubscribeRecitation()
    {
        PreferencesService.Instance.PreferencesChanged += OnRecitationPreferencesChanged;
        RecitationService.Instance.Changed += OnRecitationPackageChanged;
        RecitationService.Instance.PlaybackStopRequested += OnPlaybackStopRequested;
    }

    private async Task InitializeRecitationAsync()
    {
        try { await RecitationService.Instance.InitializeAsync(); _viewModel.RefreshRecitationAvailability(); UpdateSelectionBar(); _ = RecitationService.Instance.RefreshIfStaleAsync(); }
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Recitation extension: {ex.Message}"); }
    }

    private void OnRecitationPreferencesChanged(object? sender, EventArgs e)
    {
        if (!RecitationEnabled)
        {
            StopRecitation();
        }

        if (!RecitationEnabled && _audioDecoder != null)
        {
            _ = _audioDecoder.ReleaseAsync();
        }

        if (!RecitationEnabled && _chapterRecitationSelection)
        {
            _chapterRecitationSelection = false;
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
        _playingKey = null;
        _playingContinuous = false;
        _pendingSeekMs = null;
        _recitationBusy = false;
        if (RecitationPlayer.Source != null)
        {
            RecitationPlayer.Stop();
        }

        RecitationPlayer.Source = null;
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
            previous.TextColor = Color.FromArgb("#637598");
        }

        _recitingWord = word;
        _recitingPasuk = nextPasuk;
        if (_recitingPasuk != null)
        {
            _recitingPasuk.RecitingSegment = word!.Segment;
        }
        if (word != null && _focusedPasuk?.PasukNum == word.Pasuk && _focusedWordSpans.TryGetValue(word.Segment, out var current))
        {
            current.BackgroundColor = Color.FromArgb("#e9eff8");
            current.TextColor = Color.FromArgb("#1c427b");
        }
    }

    private void UpdateRecitationHighlight(object? sender, EventArgs e)
    {
        if (_playingKey == null || RecitationPlayer.CurrentState != MediaElementState.Playing)
        {
            return;
        }

        // Refresh the platform player's reported position before painting the word.
        RecitationPlayer.Handler?.Invoke("StatusUpdated", null);
        SetRecitingWord(_recitationTimeline?.WordAt(RecitationPlayer.Position.TotalMilliseconds));
    }

    private void ResetRecitationContext()
    {
        StopRecitation();
        _doubleTap.Reset();
        _headerPress?.Cancel();
        _chapterRecitationSelection = false;
        _focusedPasuk = null;
        _focusedWordSpans.Clear();
        FocusedPasukOverlay.IsVisible = false;
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
        _resumePosition = null;
    }

    private void OnHeaderLongPressed(object? sender, EventArgs e)
    {
        if (!RecitationEnabled || sender is not LongPressBehavior behavior ||
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
        if (OperatingSystem.IsAndroid() || OperatingSystem.IsIOS() || OperatingSystem.IsMacCatalyst() || !RecitationEnabled)
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
            StopRecitation();
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
            return;
        }

        var words = track.Words.Where(w => w.Pasuk == pasuk.PasukNum).ToList();
        if (words.Count == 0 || words[0].StartMs == null || words[^1].EndMs == null)
        {
            return;
        }

        var key = $"pasuk:{perek.PerekId}:{pasuk.PasukNum}";
        if (_playingKey == key)
        {
            // The second tap of a double-tap opens the focused pasuk — let the
            // pasuk keep playing rather than toggling pause.
            return;
        }

        await PlayRecitationAsync(key, ranges: [(words[0].StartMs!.Value, words[^1].EndMs!.Value)],
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

        ResetRecitationContext();
        _focusedPasuk = pasuk;
        FocusedSourceLabel.Text = $"{_viewModel.Source} {pasuk.PasukNumHeb}";
        FocusedPasukOverlay.IsVisible = true;
        PerekCarousel.InputTransparent = true;
        AutomationProperties.SetExcludedWithChildren(PerekCarousel, true);
        RefreshFocusedRecitation();
        BindableLayout.SetItemsSource(FocusedPerushim, _viewModel.GetPerushimForPasuk(pasuk.PasukNum));
        UpdateSelectionBar();
        try
        {
            var perekId = _viewModel.PerekId;
            await _viewModel.LoadPerushimAsync(perekId);
            if (_focusedPasuk == pasuk && _viewModel.PerekId == perekId)
            {
                BindableLayout.SetItemsSource(FocusedPerushim, _viewModel.GetPerushimForPasuk(pasuk.PasukNum));
            }
        }
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Focused commentaries: {ex.Message}"); }
    }

    private void RefreshFocusedRecitation()
    {
        _focusedWordSpans.Clear();
        if (_focusedPasuk is not { } pasuk || _viewModel.Perek is not { } perek)
        {
            return;
        }

        var track = RecitationService.Instance.GetTrack(perek.PerekId);
        var canPlayWords = RecitationEnabled && RecitationService.Instance.HasAudio(perek.PerekId) &&
            track?.AlignmentStatus == "ready" && track.Matches(perek.Pasukim);
        FocusedRecitationHint.Text = canPlayWords ? "הקישו על מילה כדי לשמוע אותה." :
            RecitationEnabled && track != null && track.AlignmentStatus != "ready"
                ? "הקראת מילים ופסוקים לפרק זה עדיין בהכנה. ההקלטה המלאה זמינה בלחיצה ארוכה על כותרת הפרק." : "";
        FocusedRecitationHint.IsVisible = FocusedRecitationHint.Text.Length > 0;
        if (!canPlayWords) { FocusedPasukText.FormattedText = pasuk.FormattedText; return; }
        var formatted = new FormattedString();
        for (var i = 0; i < pasuk.Segments.Count; i++)
        {
            var segment = pasuk.Segments[i];
            if (segment.IsQriDifferentThanKtiv)
            {
                formatted.Spans.Add(new Span { Text = "(קְרִי: ", TextColor = Color.FromArgb("#637598") });
            }

            var span = new Span
            {
                Text = segment.Type switch
                {
                    SegmentType.Ptuha => " {פ} ",
                    SegmentType.Stuma => " {ס} ",
                    _ => segment.Value
                }
            };
            var word = track!.Words.FirstOrDefault(w => w.Pasuk == pasuk.PasukNum && w.Segment == i + 1);
            if (word != null)
            {
                _focusedWordSpans[word.Segment] = span;
                span.TextColor = Color.FromArgb(_recitingWord == word ? "#1c427b" : "#637598");
                span.BackgroundColor = _recitingWord == word ? Color.FromArgb("#e9eff8") : null;
                var tap = new TapGestureRecognizer();
                tap.Tapped += async (_, _) => await PlayRecitationAsync($"word:{perek.PerekId}:{word.Pasuk}:{word.Segment}",
                    word.StartMs, word.EndMs, resumeFromMs: word.StartMs);
                span.GestureRecognizers.Add(tap);
            }
            formatted.Spans.Add(span);
            if (segment.IsQriDifferentThanKtiv)
            {
                formatted.Spans.Add(new Span { Text = ")", TextColor = Color.FromArgb("#637598") });
            }

            if (i < pasuk.Segments.Count - 1 && segment.Type is not (SegmentType.Ptuha or SegmentType.Stuma) && !segment.EndsWithMaqaf)
            {
                formatted.Spans.Add(new Span { Text = " " });
            }
        }
        FocusedPasukText.FormattedText = formatted;
    }

    private async void OnSelectionRecitationClicked(object? sender, EventArgs e)
    {
        // Only playback this button itself started (continuous or a verses range)
        // toggles pause — a tapped word or pasuk preview is not the bar's
        // playback, so Play during one starts continuous playback at the
        // tap's bookmark instead.
        var barIssued = _playingContinuous || _playingKey?.StartsWith("verses:", StringComparison.Ordinal) == true;
        if (_playingKey != null && barIssued && RecitationPlayer.CurrentState is MediaElementState.Playing or MediaElementState.Paused)
        {
            if (RecitationPlayer.CurrentState == MediaElementState.Playing)
            {
                RecitationPlayer.Pause();
            }
            else
            {
                RecitationPlayer.Play();
            }

            return;
        }
        if (_viewModel.Perek is not { } perek)
        {
            return;
        }

        var track = RecitationService.Instance.GetTrack(perek.PerekId);
        if (_chapterRecitationSelection || _playingKey != null)
        {
            await PlayRecitationAsync($"chapter:{perek.PerekId}");
            return;
        }
        var numbers = _focusedPasuk != null ? new[] { _focusedPasuk.PasukNum } : _viewModel.SelectedPasukNums.Order().ToArray();
        if (track?.AlignmentStatus != "ready" || numbers.Length == 0)
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
        if (!RecitationEnabled || _viewModel.Perek is not { } perek)
        {
            return;
        }

        // A tapped word or pasuk marks where the next continuous playback resumes.
        // It is set on request so pressing Play before the preview finishes still
        // resumes there, and it outlives the preview's own stop/reset.
        if (resumeFromMs is double resume)
        {
            _resumePosition = (perek.PerekId, resume);
        }
        var continuous = start == null && ranges == null;

        if (_playingKey == key && RecitationPlayer.CurrentState is MediaElementState.Playing or MediaElementState.Paused)
        {
            if (RecitationPlayer.CurrentState == MediaElementState.Playing)
            {
                RecitationPlayer.Pause();
            }
            else
            {
                RecitationPlayer.Play();
            }

            return;
        }
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
            _audioDecoder ??= new MpegRecitationAudioDecoder(RecitationDecoderView);
            var path = await RecitationService.Instance.PrepareAudioAsync(perek.PerekId, perek.Pasukim, start, end, request.Token, ranges, _audioDecoder, pauseMs);
            if (request.IsCancellationRequested || _viewModel.Perek != perek || !RecitationEnabled)
            {
                return;
            }

            _playingKey = key;
            _playingContinuous = continuous;
            _recitationTimeline = track?.AlignmentStatus == "ready"
                ? new RecitationTimeline(track, ranges ?? (start.HasValue && end.HasValue ? [(start.Value, end.Value)] : null), pauseMs) : null;
            // The timeline maps the tapped-word resume point into this clip's position.
            _pendingSeekMs = continuous && _resumePosition is { } point && point.PerekId == perek.PerekId
                ? _recitationTimeline?.PositionOf(point.StartMs)
                : null;
            RecitationPlayer.Speed = preferences.RecitationSpeed;
            RecitationPlayer.Volume = preferences.RecitationVolume;
            _playWhenOpened = true;
            RecitationPlayer.Source = MediaSource.FromFile(path);
        }
        catch (OperationCanceledException) { /* Navigation or another selection cancels the old request. */ }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Recitation playback: {ex}");
            if (!request.IsCancellationRequested)
            {
                await DisplayAlertAsync("הקראה", "לא ניתן להשמיע את ההקלטה. בדקו את חבילת ההקראה בהעדפות.", "אישור");
            }
        }
        finally
        {
            if (_recitationRequest == request) { _recitationRequest = null; _recitationBusy = false; UpdateSelectionBar(); }
        }
    }

    private async void OnRecitationMediaOpened(object? sender, EventArgs e)
    {
        if (!_playWhenOpened || !RecitationEnabled)
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
                await RecitationPlayer.SeekTo(TimeSpan.FromMilliseconds(seekMs), timeout.Token);
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
        RecitationPlayer.Play();
    }
    private void OnRecitationMediaEnded(object? sender, EventArgs e)
    {
        if (_playingContinuous)
        {
            // The resumed playback ran to the end of the perek; the next Play starts over.
            _resumePosition = null;
        }
        _playingKey = null;
        _playingContinuous = false;
        ClearRecitationHighlight();
        UpdateSelectionBar();
    }
    private void OnRecitationStateChanged(object? sender, MediaStateChangedEventArgs e)
    {
        _recitationFrameTimer?.Stop();
        if (_playingKey != null && _recitationTimeline != null && RecitationPlayer.CurrentState == MediaElementState.Playing)
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
        else if (RecitationPlayer.CurrentState is MediaElementState.Stopped or MediaElementState.None or MediaElementState.Failed)
        {
            SetRecitingWord(null);
        }
        UpdateSelectionBar();
    }
    private async void OnRecitationMediaFailed(object? sender, MediaFailedEventArgs e)
    {
        if (_playingKey == null)
        {
            return;
        }

        StopRecitation(); UpdateSelectionBar();
        await DisplayAlertAsync("הקראה", "לא ניתן להשמיע את ההקלטה במכשיר זה.", "אישור");
    }

    protected override bool OnBackButtonPressed()
    {
        return TryHandleReaderBack() || base.OnBackButtonPressed();
    }

    private bool TryHandleReaderBack()
    {
        if (ExitFullScreenButton.IsVisible)
        { ExitFullScreen(); return true; }
        if (ReaderMenuOverlay.IsVisible)
        { ReaderMenuOverlay.IsVisible = false; return true; }
        if (ChapterSearch.IsSearchOpen) { ChapterSearch.HandleBack(); return true; }
        if (_focusedPasuk != null || _chapterRecitationSelection || _viewModel.SelectedPasukNums.Count > 0)
        { ClearAllSelections(); return true; }
        return false;
    }
}
