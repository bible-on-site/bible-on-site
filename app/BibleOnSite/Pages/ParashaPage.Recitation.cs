using BibleOnSite.Behaviors;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using CommunityToolkit.Maui.Core;
using CommunityToolkit.Maui.Views;

namespace BibleOnSite.Pages;

/// <summary>
/// Recitation half of <see cref="ParashaPage"/> — the על הפרק reader's
/// קריינות surface adapted to a multi-perek unit: pasuk/word previews stay
/// inside one perek's track, while "play the unit" chains each covered
/// perek's recording in range order (Torah first, then each Haftarah
/// variant), skipping slices with no downloaded audio. Word highlighting
/// resolves through the unit's canonical <see cref="Pasuk"/> rows.
/// </summary>
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class ParashaPage
#pragma warning restore S2333
{
    /// <summary>One perek-scoped clip inside a playback plan.</summary>
    private sealed record RecitationSegment(int PerekId, IReadOnlyList<Pasuk> Pasukim,
        double? Start, double? End, IReadOnlyList<(double Start, double End)>? Ranges);

    private readonly DoubleTapTracker _doubleTap = new();
    private bool _unitRecitationSelection;
    private Pasuk? _focusedPasuk;
    private int _focusedPerekId;
    private CancellationTokenSource? _recitationRequest;
    private CancellationTokenSource? _headerPress;
    private bool _recitationBusy;
    private bool _playWhenOpened;
    // Playback identity, unit-vs-preview distinction and the perek-scoped
    // resume bookmark live together so pause/stop/end stay consistent.
    private readonly RecitationPlaybackCursor _recitationCursor = new();
    private double? _pendingSeekMs;
    private int _recitationGeneration;
    private MpegRecitationAudioDecoder? _audioDecoder;
    private IDispatcherTimer? _recitationFrameTimer;
    private RecitationTimeline? _recitationTimeline;
    private int _recitationTimelinePerekId;
    private Pasuk? _recitingPasuk;
    private RecitationWord? _recitingWord;
    private readonly Dictionary<int, Span> _focusedWordSpans = [];
    // Remaining perek clips of an in-flight unit plan; an empty queue means
    // MediaEnded finishes the playback instead of chaining the next perek.
    private readonly Queue<RecitationSegment> _recitationQueue = new();
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

        if (!RecitationAvailable && _unitRecitationSelection)
        {
            _unitRecitationSelection = false;
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
        _recitationQueue.Clear();
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

    /// <summary>The canonical pasuk a highlighted word belongs to, found by its perek.</summary>
    private Pasuk? FindRecitingPasuk(int perekId, int pasukNum) =>
        _viewModel.Unit?.Rows.FirstOrDefault(
            row => row.PerekId == perekId && row.PasukNum == pasukNum && row.Pasuk != null)?.Pasuk;

    private void SetRecitingWord(RecitationWord? word)
    {
        if (_recitingWord == word)
        {
            return;
        }

        var nextPasuk = word == null ? null : FindRecitingPasuk(_recitationTimelinePerekId, word.Pasuk);
        if (_recitingPasuk != null && _recitingPasuk != nextPasuk)
        {
            _recitingPasuk.RecitingSegment = null;
        }
        if (_recitingWord != null && _focusedPasuk?.PasukNum == _recitingWord.Pasuk &&
            _focusedPerekId == _recitationTimelinePerekId &&
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
        if (word != null && _focusedPasuk?.PasukNum == word.Pasuk && _focusedPerekId == _recitationTimelinePerekId &&
            _focusedWordSpans.TryGetValue(word.Segment, out var current))
        {
            current.BackgroundColor = Color.FromArgb("#e9eff8");
            current.TextColor = Color.FromArgb("#1c427b");
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
        _unitRecitationSelection = false;
        _focusedPasuk = null;
        _focusedPerekId = 0;
        _focusedWordSpans.Clear();
        FocusedPasukOverlay.IsVisible = false;
        FocusedPasukOverlay.PerushimSource = null;
        ParashaCarousel.InputTransparent = false;
        AutomationProperties.SetExcludedWithChildren(ParashaCarousel, false);
        if (_audioDecoder != null)
        {
            _ = _audioDecoder.ReleaseAsync();
        }
    }

    /// <summary>
    /// Unit changes and page exits also drop the continuous-playback resume
    /// position; opening or closing the focused pasuk keeps it.
    /// </summary>
    private void ResetRecitationSession()
    {
        ResetRecitationContext();
        _recitationCursor.Reset();
        // Leaving the reader or switching units drops the audio claim at once
        // — a hidden player must not keep external music paused (#2642).
        _audioLease?.Dispose();
        _audioLease = null;
    }

    /// <summary>Header play button — קריינות mode plays the whole unit.</summary>
    private async void OnHeaderPlayClicked(object? sender, EventArgs e) =>
        await PlayUnitRecitationAsync();

    private void OnHeaderLongPressed(object? sender, EventArgs e)
    {
        if (!RecitationAvailable || sender is not LongPressBehavior behavior ||
            behavior.AssociatedView?.BindingContext is not ParashaUnit unit || unit != _viewModel.Unit)
        {
            return;
        }

        EnterUnitRecitation();
    }

    private void EnterUnitRecitation()
    {
        ResetRecitationContext();
        _viewModel.ClearSelected();
        _unitRecitationSelection = true;
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
        var unit = (sender as Label)?.BindingContext as ParashaUnit;
        try
        {
            await Task.Delay(600, request.Token);
            if (unit != null && unit == _viewModel.Unit)
            {
                EnterUnitRecitation();
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

    private async Task HandlePasukTapAsync(ParashaDisplayItem row)
    {
        if (_viewModel.SelectedPasukCount > 0)
        {
            // Toggling a pasuk in selection mode must not stop playback or the
            // moving word marker (#2473); the selection bar stays the pause surface.
            _doubleTap.Reset();
            _viewModel.ToggleSelectedPasuk(row.PerekId, row.PasukNum);
            UpdatePasukSelection();
            return;
        }
        var doubled = _doubleTap.Tap(row.PerekId, row.PasukNum, Environment.TickCount64);
        if (!doubled)
        {
            // קריינות: a single tap plays just this pasuk; a double tap still
            // reaches the focused-pasuk view on the second Tap() call.
            if (CanPlayPasukOnTap(row))
            {
                await PlayPasukRecitationAsync(row.PerekId, row.Pasuk!);
            }
            return;
        }

        await OpenFocusedPasukAsync(row);
    }

    /// <summary>
    /// Single-tap pasuk playback applies only while קריינות is checked and the
    /// pasuk's own perek has downloaded audio.
    /// </summary>
    private bool CanPlayPasukOnTap(ParashaDisplayItem row) => _viewModel.IsQriynotEnabled &&
        row.Pasuk != null && RecitationService.Instance.HasAudio(row.PerekId);

    /// <summary>
    /// Plays exactly one pasuk by bounding the track to its word timings.
    /// Requires an aligned ("ready") track — without word timings there is no
    /// pasuk boundary to stop at.
    /// </summary>
    private async Task PlayPasukRecitationAsync(int perekId, Pasuk pasuk)
    {
        var track = RecitationService.Instance.GetTrack(perekId);
        if (track?.AlignmentStatus != "ready")
        {
            // Without aligned word timings a pasuk has no playback boundary —
            // the controls already show word/verse recitation unavailable, so
            // the tap does nothing. A missing track is real missing audio and
            // still reports.
            if (track == null)
            {
                await DisplayAlertAsync("הקראה", "אין הקלטה לפרק זה", "אישור");
            }
            return;
        }

        var words = track.Words.Where(w => w.Pasuk == pasuk.PasukNum).ToList();
        if (words.Count == 0 || words[0].StartMs == null || words[^1].EndMs == null)
        {
            // A "ready" track missing this pasuk's timings is corrupt pack
            // data — a real failure, reported like other playback failures.
            await DisplayAlertAsync("הקראה", "לא ניתן להשמיע את ההקלטה. בדקו את חבילת ההקראה בהעדפות.", "אישור");
            return;
        }

        var perekPasukim = PerekDataService.Instance.GetPerek(perekId)?.Pasukim;
        if (perekPasukim == null)
        {
            return;
        }

        // Tapping the playing pasuk again goes through the shared toggle; the
        // second tap of a double-tap opens the focused pasuk and keeps it.
        await PlayRecitationAsync($"pasuk:{perekId}:{pasuk.PasukNum}",
            new RecitationSegment(perekId, perekPasukim, null, null,
                [(words[0].StartMs!.Value, words[^1].EndMs!.Value)]),
            resumeFromMs: words[0].StartMs!.Value);
    }

    private async void OnPasukDoubleTapped(object? sender, TappedEventArgs e)
    {
#if !ANDROID
        if (_viewModel.SelectedPasukCount == 0 && e.Parameter is ParashaDisplayItem row && row.Pasuk != null)
        {
            await OpenFocusedPasukAsync(row);
        }
#else
        await Task.CompletedTask;
#endif
    }

    private async Task OpenFocusedPasukAsync(ParashaDisplayItem row)
    {
        var pasuk = row.Pasuk;
        if (pasuk == null || (_focusedPasuk == pasuk && _focusedPerekId == row.PerekId))
        {
            return;
        }

        // A pasuk preview that is still playing keeps playing into the focused
        // view — its words highlight there live and the bar can pause it.
        ResetRecitationContext(stopPlayback: false);
        _focusedPasuk = pasuk;
        _focusedPerekId = row.PerekId;
        // A double tap's first press paused this pasuk's preview through the
        // shared toggle — opening its focused view resumes it so the clip does
        // not sit silently paused.
        if (RecitationPlayer is { } focusedPlayer &&
            _recitationCursor.ResumesOnPasukFocus(row.PerekId, pasuk.PasukNum,
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
            _recitationCursor.PlayingKey != $"pasuk:{row.PerekId}:{pasuk.PasukNum}" &&
            CanPlayFocusedPasuk)
        {
            _ = PlayPasukRecitationAsync(row.PerekId, pasuk);
        }
        FocusedPasukOverlay.SourceText = $"{PerekDataService.Instance.GetPerekSource(row.PerekId) ?? string.Empty} {pasuk.PasukNumHeb}";
        FocusedPasukOverlay.IsVisible = true;
        ParashaCarousel.InputTransparent = true;
        AutomationProperties.SetExcludedWithChildren(ParashaCarousel, true);
        RefreshFocusedRecitation();
        FocusedPasukOverlay.PerushimSource = _viewModel.GetPerushimForRow(row.PerekId, pasuk.PasukNum);
        UpdateSelectionBar();
        try
        {
            var unit = _viewModel.Unit;
            if (unit != null)
            {
                await _viewModel.LoadPerushimAsync(unit);
            }
            if (_focusedPasuk == pasuk && _focusedPerekId == row.PerekId)
            {
                FocusedPasukOverlay.PerushimSource = _viewModel.GetPerushimForRow(row.PerekId, pasuk.PasukNum);
            }
        }
        #pragma warning disable S2221 // Deliberate failure boundary: focused-commentary refresh is best-effort
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Focused commentaries: {ex.Message}"); } //NOSONAR — focused-commentary refresh is best-effort.
        #pragma warning restore S2221
    }

    private void RefreshFocusedRecitation()
    {
        _focusedWordSpans.Clear();
        if (_focusedPasuk is not { } pasuk || _viewModel.Unit == null || _focusedPerekId <= 0)
        {
            FocusedPasukOverlay.PlayButtonVisible = false;
            return;
        }

        FocusedPasukOverlay.PlayButtonVisible = RecitationAvailable;
        FocusedPasukOverlay.PlayButtonEnabled = CanPlayFocusedPasuk;
        var perekPasukim = PerekDataService.Instance.GetPerek(_focusedPerekId)?.Pasukim;
        var track = RecitationService.Instance.GetTrack(_focusedPerekId);
        var canPlayWords = RecitationAvailable && RecitationService.Instance.HasAudio(_focusedPerekId) &&
            track?.AlignmentStatus == "ready" && perekPasukim != null && track.Matches(perekPasukim);
        FocusedPasukOverlay.HintText = canPlayWords ? "הקישו על מילה כדי לשמוע אותה." : "";
        if (!canPlayWords) { FocusedPasukOverlay.PasukText.FormattedText = pasuk.FormattedText; return; }
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
                span.TextColor = Color.FromArgb(_recitingWord == word ? "#1c427b" : "#637598");
                span.BackgroundColor = _recitingWord == word ? Color.FromArgb("#e9eff8") : null;
                var tap = new TapGestureRecognizer();
                var perekId = _focusedPerekId;
                tap.Tapped += async (_, _) => await PlayRecitationAsync($"word:{perekId}:{word.Pasuk}:{word.Segment}",
                    new RecitationSegment(perekId, perekPasukim!, word.StartMs, word.EndMs, null),
                    resumeFromMs: word.StartMs);
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
        FocusedPasukOverlay.PasukText.FormattedText = formatted;
    }

    /// <summary>
    /// The focused-view headphones action plays the whole pasuk — offered while
    /// the pasuk's own perek track can bound a pasuk clip (timings ready).
    /// </summary>
    private bool CanPlayFocusedPasuk => _focusedPasuk != null && _focusedPerekId > 0 &&
        RecitationAvailable &&
        RecitationService.Instance.GetTrack(_focusedPerekId) is { AlignmentStatus: "ready" } focusedTrack &&
        PerekDataService.Instance.GetPerek(_focusedPerekId)?.Pasukim is { } focusedPasukim &&
        focusedTrack.Matches(focusedPasukim) &&
        focusedTrack.Words.Any(w => w.Pasuk == _focusedPasuk.PasukNum && w.StartMs != null && w.EndMs != null);

    private async void OnFocusedPlayClicked(object? sender, EventArgs e)
    {
        if (_focusedPasuk is { } pasuk && _focusedPerekId > 0)
        {
            await PlayPasukRecitationAsync(_focusedPerekId, pasuk);
        }
    }

    /// <summary>Whether every selected pesukim's perek track can bound a verses clip.</summary>
    private bool CanPlaySelectedPasukim()
    {
        var selected = _viewModel.SelectedPasukim;
        if (selected.Count == 0)
        {
            return false;
        }
        return selected.GroupBy(s => s.PerekId).All(g =>
            RecitationService.Instance.GetTrack(g.Key) is { AlignmentStatus: "ready" } track &&
            PerekDataService.Instance.GetPerek(g.Key)?.Pasukim is { } pasukim && track.Matches(pasukim));
    }

    /// <summary>Whether any perek the unit reads has a downloaded recording.</summary>
    private bool CanPlayUnit => _viewModel.Unit is { } unit &&
        ParashaUnitText.PerekIdsForUnit(unit).Any(id => RecitationService.Instance.HasAudio(id));

    private async void OnSelectionRecitationClicked(object? sender, EventArgs e)
    {
        // Playback the recitation controls themselves issued (the unit, a
        // verses range, or a pasuk preview) toggles pause and resume — a tapped
        // word preview is a bookmark, not the bar's playback (#2157), so Play
        // during one starts unit playback at that word instead.
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
        if (_viewModel.Unit is null)
        {
            return;
        }

        // With nothing selected the Play button means the unit — a bookmarked
        // word or pasuk resumes there instead of restarting (#2157).
        if (_unitRecitationSelection || _recitationCursor.PlayingKey != null ||
            (_focusedPasuk == null && _viewModel.SelectedPasukim.Count == 0))
        {
            await PlayUnitRecitationAsync();
            return;
        }

        if (_focusedPasuk is { } focused && _focusedPerekId > 0)
        {
            await PlayPasukRecitationAsync(_focusedPerekId, focused);
            return;
        }

        // A selection may cross the unit's perek boundary: each perek's pesukim
        // become one chained verses clip, in row order.
        var segments = new List<RecitationSegment>();
        foreach (var group in _viewModel.SelectedPasukim.GroupBy(s => s.PerekId))
        {
            var track = RecitationService.Instance.GetTrack(group.Key);
            var pasukim = PerekDataService.Instance.GetPerek(group.Key)?.Pasukim;
            if (track?.AlignmentStatus != "ready" || pasukim == null || !track.Matches(pasukim))
            {
                continue;
            }

            var ranges = group.OrderBy(s => s.PasukNum)
                .Select(s => track.Words.Where(w => w.Pasuk == s.PasukNum).ToList()).ToList();
            if (ranges.Any(r => r.Count == 0))
            {
                continue;
            }

            segments.Add(new RecitationSegment(group.Key, pasukim, null, null,
                ranges.Select(r => (r[0].StartMs!.Value, r[^1].EndMs!.Value)).ToList()));
        }
        if (segments.Count == 0)
        {
            return;
        }

        await PlayRecitationPlanAsync(
            $"verses:{string.Join(';', segments.Select(s => s.PerekId))}", continuous: false, segments);
    }

    /// <summary>
    /// Unit playback: each perek the unit reads contributes one clip, clipped
    /// to the range's pasuk bounds via word timings when the track is aligned.
    /// A partial slice on an unaligned track cannot be bounded, so only
    /// whole-perek slices play without alignment — matching the reader's
    /// contract that a clip never reads outside the selected bounds.
    /// </summary>
    private async Task PlayUnitRecitationAsync()
    {
        if (_viewModel.Unit is not { } unit)
        {
            return;
        }

        var segments = new List<RecitationSegment>();
        var preferences = PreferencesService.Instance;
        var versePause = preferences.RecitationVersePauseMs >= 0;
        foreach (var slice in ParashaUnitText.PerekSlicesForUnit(unit))
        {
            var perekId = slice.PerekId;
            var pasukim = PerekDataService.Instance.GetPerek(perekId)?.Pasukim;
            var track = RecitationService.Instance.GetTrack(perekId);
            if (pasukim == null || track == null || !RecitationService.Instance.HasAudio(perekId))
            {
                continue;
            }

            var startPasuk = slice.StartPasuk;
            var endPasuk = Math.Min(slice.EndPasuk, pasukim.Count);
            var wholePerek = startPasuk <= 1 && endPasuk >= pasukim.Count;
            if (track.AlignmentStatus == "ready" && track.Matches(pasukim))
            {
                var sliceWords = track.Words.Where(w => w.Pasuk >= startPasuk && w.Pasuk <= endPasuk).ToList();
                if (sliceWords.Count == 0)
                {
                    continue;
                }

                // Verse pauses keep the perek reader's cadence inside the slice.
                var ranges = versePause
                    ? sliceWords.GroupBy(w => w.Pasuk).OrderBy(g => g.Key)
                        .Select(g => (g.First().StartMs!.Value, g.Last().EndMs!.Value)).ToList()
                    : [(sliceWords[0].StartMs!.Value, sliceWords[^1].EndMs!.Value)];
                segments.Add(new RecitationSegment(perekId, pasukim, null, null, ranges));
            }
            else if (wholePerek)
            {
                segments.Add(new RecitationSegment(perekId, pasukim, null, null, null));
            }
            // A partial slice on an unaligned track has no word boundary — skip.
        }
        if (segments.Count == 0)
        {
            return;
        }

        await PlayRecitationPlanAsync($"unit:{unit.UnitId}", continuous: true, segments);
    }

    /// <summary>Queues a multi-clip plan and starts its first segment.</summary>
    private async Task PlayRecitationPlanAsync(string key, bool continuous, List<RecitationSegment> segments)
    {
        if (!RecitationAvailable || segments.Count == 0)
        {
            return;
        }

        StopRecitation();
        _recitationCursor.Begin(key, continuous);
        _recitationQueue.Clear();
        foreach (var segment in segments.Skip(1))
        {
            _recitationQueue.Enqueue(segment);
        }
        await PlaySegmentClipAsync(segments[0]);
    }

    /// <summary>Single-segment playback entry point with the shared key toggle.</summary>
    private async Task PlayRecitationAsync(string key, RecitationSegment segment, double? resumeFromMs = null)
    {
        if (resumeFromMs is double resume)
        {
            _recitationCursor.MarkResume(segment.PerekId, resume);
        }

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
        StopRecitation();
        _recitationCursor.Begin(key, continuous: false);
        await PlaySegmentClipAsync(segment);
    }

    /// <summary>
    /// Prepares one perek's clip and hands it to the player — the per-segment
    /// half of the perek reader's <c>PlayRecitationAsync</c>, unchanged in
    /// behavior except that the perek comes from the segment, not the page.
    /// </summary>
    private async Task PlaySegmentClipAsync(RecitationSegment segment)
    {
        if (!RecitationAvailable)
        {
            return;
        }

        // Keep the claim across the deliberate gap — stopping the old clip,
        // decoding and opening the next segment run through silent player
        // states on the way back to Playing (#2642).
        using var audioHold = AudioLease.Hold();
        using var request = new CancellationTokenSource();
        _recitationRequest = request;
        _recitationBusy = true;
        UpdateSelectionBar();
        try
        {
            var preferences = PreferencesService.Instance;
            var track = RecitationService.Instance.GetTrack(segment.PerekId);
            var ranges = segment.Ranges;
            if (ranges == null && segment.Start == null && preferences.RecitationVersePauseMs >= 0 && track?.AlignmentStatus == "ready")
            {
                ranges = track.Words.GroupBy(w => w.Pasuk).OrderBy(g => g.Key)
                    .Select(g => (g.First().StartMs!.Value, g.Last().EndMs!.Value)).ToList();
            }
            // MediaElement's position is in source time; scale generated silence so
            // the user's pause retains its wall-clock length at every speed.
            var pauseMs = ranges is { Count: > 1 } && preferences.RecitationVersePauseMs >= 0
                ? preferences.RecitationVersePauseMs * preferences.RecitationSpeed : 0;
            _audioDecoder ??= new MpegRecitationAudioDecoder(RecitationDecoder.GetOrCreateView());
            var path = await RecitationService.Instance.PrepareAudioAsync(segment.PerekId, segment.Pasukim,
                segment.Start, segment.End, request.Token, ranges, _audioDecoder, pauseMs);
            if (request.IsCancellationRequested || !RecitationAvailable ||
                _recitationCursor.PlayingKey == null)
            {
                return;
            }

            _recitationTimelinePerekId = segment.PerekId;
            _recitationTimeline = track?.AlignmentStatus == "ready"
                ? new RecitationTimeline(track, ranges ?? (segment.Start.HasValue && segment.End.HasValue ? [(segment.Start.Value, segment.End.Value)] : null), pauseMs) : null;
            // The timeline maps the tapped-word resume point into this clip's position.
            _pendingSeekMs = _recitationCursor.PendingSeekFor(segment.PerekId, _recitationCursor.PlayingContinuous, _recitationTimeline);
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
        await Task.CompletedTask;
    }
    private void OnRecitationMediaEnded(object? sender, EventArgs e)
    {
        // iOS can keep CurrentState at Playing once an item finishes, so the
        // end event releases the audio claim itself — a chained next clip
        // holds it before the release lands (#2642).
        _audioLease?.Idle();
        // A unit plan chains its next perek clip before the playback is done.
        if (_recitationQueue.Count > 0 && _recitationCursor.PlayingKey != null)
        {
            _ = PlaySegmentClipAsync(_recitationQueue.Dequeue());
            UpdateSelectionBar();
            return;
        }
        // A completed playback consumes the resume bookmark; a finished preview keeps it.
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
        if (ReaderMenuOverlay.IsOpen)
        { ReaderMenuOverlay.Close(); return true; }
        if (ChapterSearch.IsSearchOpen) { ChapterSearch.HandleBack(); return true; }
        // Whatever keeps the selection bar up also owns Back — including a clip
        // playing with nothing selected, which stops instead of navigating.
        if (ReaderSurfaceState.IsActive(_viewModel.SelectedPasukCount, _unitRecitationSelection,
                _focusedPasuk != null, _recitationCursor.PlayingKey != null))
        { ClearAllSelections(); return true; }
        return false;
    }
}
