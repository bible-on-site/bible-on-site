using BibleOnSite.Behaviors;
using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.Pages;

/// <summary>
/// Recitation half of <see cref="ParashaPage"/> — the על הפרק reader's
/// קריינות surface adapted to a multi-perek unit. The shared
/// <see cref="ReaderRecitationEngine"/> owns the player lifecycle, clip
/// queue, cursor/resume bookmark, highlight ticker and audio ownership;
/// this partial keeps the page UX: header gestures, single/double tap,
/// the focused-pasuk overlay, word→row highlight mapping and the
/// selection bar. "Play the unit" plans each covered perek's recording
/// in range order (Torah first, then each Haftarah variant) through
/// <see cref="RecitationRangePlanner"/>, skipping slices with no
/// downloaded audio.
/// </summary>
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class ParashaPage
#pragma warning restore S2333
{
    private readonly DoubleTapTracker _doubleTap = new();
    private bool _unitRecitationSelection;
    private Pasuk? _focusedPasuk;
    private int _focusedPerekId;
    private CancellationTokenSource? _headerPress;
    private Pasuk? _recitingPasuk;
    private RecitationWord? _recitingWord;
    private readonly Dictionary<int, Span> _focusedWordSpans = [];
    private ReaderRecitationEngine? _recitation;

    /// <summary>
    /// The shared engine — created lazily because its surface adapter needs
    /// the XAML hosts; subscribing the engine's notifications is part of the
    /// first creation.
    /// </summary>
    private ReaderRecitationEngine Recitation => _recitation ??= CreateRecitationEngine();

    private ReaderRecitationEngine CreateRecitationEngine()
    {
        var engine = new ReaderRecitationEngine(
            RecitationService.Instance,
            PreferencesService.Instance,
            PlaybackAudioOwnership.Shared,
            this,
            new MediaElementRecitationSurface(RecitationPlayerHost),
            () => new MpegRecitationAudioDecoder(RecitationDecoder.GetOrCreateView()),
            (interval, tick) => new DispatcherFrameTicker(Dispatcher, interval, tick),
            ShellAppNavigator.Instance.DisplayAlertAsync);
        engine.Changed += (_, _) => UpdateSelectionBar();
        engine.WordChanged += (_, word) => ApplyRecitingWord(word);
        return engine;
    }

    /// <summary>The live player state for the bar's glyph — null before the player exists.</summary>
    private RecitationPlaybackState? RecitationPlayerState => _recitation?.PlayerState;

    /// <summary>
    /// Whether recitation playback is allowed on this device: the catalog is
    /// installed AND the global קריינות preference (העדפות → על הפרק, default
    /// on) is enabled. Off hides every headphones action and suppresses
    /// tap/focus-triggered playback consistently (#2472).
    /// </summary>
    private bool RecitationAvailable => Recitation.Available;

    private void SubscribeRecitation()
    {
        PreferencesService.Instance.PreferencesChanged += OnRecitationPreferencesChanged;
        RecitationService.Instance.Changed += OnRecitationPackageChanged;
        RecitationService.Instance.PlaybackStopRequested += OnPlaybackStopRequested;
    }

    private async Task InitializeRecitationAsync()
    {
        await Recitation.InitializeAsync();
        _viewModel.RefreshRecitationAvailability();
        UpdateSelectionBar();
    }

    private void OnRecitationPreferencesChanged(object? sender, EventArgs e)
    {
        Recitation.PreferencesChanged();
        if (!RecitationAvailable && _unitRecitationSelection)
        {
            _unitRecitationSelection = false;
        }

        RefreshFocusedRecitation();
        UpdateSelectionBar();
    }

    private void OnRecitationPackageChanged(object? sender, EventArgs e) => Dispatcher.Dispatch(() =>
    {
        _viewModel.RefreshRecitationAvailability(); RefreshFocusedRecitation(); UpdateSelectionBar();
    });
    private void OnPlaybackStopRequested(object? sender, EventArgs e) => Dispatcher.Dispatch(() =>
    {
        Recitation.StopPlayback(); UpdateSelectionBar();
    });

    private void StopRecitation() => Recitation.StopPlayback();

    /// <summary>The canonical pasuk a highlighted word belongs to, found by its perek.</summary>
    private Pasuk? FindRecitingPasuk(int perekId, int pasukNum) =>
        _viewModel.Unit?.Rows.FirstOrDefault(
            row => row.PerekId == perekId && row.PasukNum == pasukNum && row.Pasuk != null)?.Pasuk;

    /// <summary>Maps the engine's highlighted word onto the displayed pasuk and the focused overlay's spans.</summary>
    private void ApplyRecitingWord(RecitationWord? word)
    {
        var timelinePerekId = Recitation.TimelinePerekId;
        var nextPasuk = word == null ? null : FindRecitingPasuk(timelinePerekId, word.Pasuk);
        if (_recitingPasuk != null && _recitingPasuk != nextPasuk)
        {
            _recitingPasuk.RecitingSegment = null;
        }
        if (_recitingWord != null && _focusedPasuk?.PasukNum == _recitingWord.Pasuk &&
            _focusedPerekId == timelinePerekId &&
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
        if (word != null && _focusedPasuk?.PasukNum == word.Pasuk && _focusedPerekId == timelinePerekId &&
            _focusedWordSpans.TryGetValue(word.Segment, out var current))
        {
            current.BackgroundColor = Pasuk.RecitingBackgroundDefault;
            current.TextColor = Pasuk.RecitingText;
        }
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
        Recitation.ReleaseDecoder();
    }

    /// <summary>
    /// Unit changes and page exits also drop the continuous-playback resume
    /// position and the audio claim at once — a hidden player must not keep
    /// external music paused (#2642).
    /// </summary>
    private void ResetRecitationSession()
    {
        ResetRecitationContext();
        Recitation.ResetSession();
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
                await ShellAppNavigator.Instance.DisplayAlertAsync("הקראה", "אין הקלטה לפרק זה", "אישור");
            }
            return;
        }

        var words = track.GetWords(pasuk.PasukNum);
        if (words.Count == 0 || words[0].StartMs == null || words[^1].EndMs == null)
        {
            // A "ready" track missing this pasuk's timings is corrupt pack
            // data — a real failure, reported like other playback failures.
            await ShellAppNavigator.Instance.DisplayAlertAsync("הקראה", "לא ניתן להשמיע את ההקלטה. בדקו את חבילת ההקראה בהעדפות.", "אישור");
            return;
        }

        var perekPasukim = _viewModel.GetLoadedPasukim(perekId);
        if (perekPasukim == null)
        {
            return;
        }

        // Tapping the playing pasuk again goes through the shared toggle; the
        // second tap of a double-tap opens the focused pasuk and keeps it.
        await Recitation.PlayClipAsync($"pasuk:{perekId}:{pasuk.PasukNum}", continuous: false,
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
        if (_recitation?.PlayerState is RecitationPlaybackState.Playing or RecitationPlaybackState.Paused &&
            Recitation.Cursor.ResumesOnPasukFocus(row.PerekId, pasuk.PasukNum,
                _recitation.PlayerState == RecitationPlaybackState.Playing))
        {
            Recitation.ResumePlayback();
        }
        // The full pasuk source lives in the shared toolbar title, set by
        // UpdateSelectionBar below (#2466).
        // Opening the focused pasuk plays it (#2472). An in-flight clip for
        // this same pasuk continues/resumes untouched — one deliberate open
        // issues at most one playback request.
        else if (RecitationAvailable &&
            Recitation.Cursor.PlayingKey != $"pasuk:{row.PerekId}:{pasuk.PasukNum}" &&
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
        var perekPasukim = _viewModel.GetLoadedPasukim(_focusedPerekId);
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
            var word = track!.GetWord(pasuk.PasukNum, i + 1);
            if (word != null)
            {
                _focusedWordSpans[word.Segment] = span;
                var reciting = _recitingWord == word;
                span.TextColor = reciting ? Pasuk.RecitingText : Pasuk.QriTextColor;
                span.BackgroundColor = reciting ? Pasuk.RecitingBackgroundDefault : null;
                var tap = new TapGestureRecognizer();
                var perekId = _focusedPerekId;
                tap.Tapped += async (_, _) => await Recitation.PlayClipAsync(
                    $"word:{perekId}:{word.Pasuk}:{word.Segment}", continuous: false,
                    new RecitationSegment(perekId, perekPasukim!, word.StartMs, word.EndMs, null),
                    resumeFromMs: word.StartMs);
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

    /// <summary>
    /// The focused-view headphones action plays the whole pasuk — offered while
    /// the pasuk's own perek track can bound a pasuk clip (timings ready).
    /// </summary>
    private bool CanPlayFocusedPasuk => _focusedPasuk != null && _focusedPerekId > 0 &&
        RecitationAvailable &&
        RecitationService.Instance.GetTrack(_focusedPerekId) is { AlignmentStatus: "ready" } focusedTrack &&
        _viewModel.GetLoadedPasukim(_focusedPerekId) is { } focusedPasukim &&
        focusedTrack.Matches(focusedPasukim) &&
        focusedTrack.GetWords(_focusedPasuk.PasukNum).Any(w => w.StartMs != null && w.EndMs != null);

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
            _viewModel.GetLoadedPasukim(g.Key) is { } pasukim && track.Matches(pasukim));
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
        if (Recitation.Cursor.BarIssued && Recitation.ToggleBarPlayback())
        {
            return;
        }
        if (_viewModel.Unit is null)
        {
            return;
        }

        // With nothing selected the Play button means the unit — a bookmarked
        // word or pasuk resumes there instead of restarting (#2157).
        if (_unitRecitationSelection || Recitation.Cursor.PlayingKey != null ||
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
        // become one chained verses clip. Groups order by the perek's first
        // row — GroupBy's tap order would play a later perek selected first
        // ahead of an earlier reading.
        var rowOrder = new Dictionary<int, int>();
        var rows = _viewModel.Unit.Rows;
        for (var i = 0; i < rows.Count; i++)
        {
            rowOrder.TryAdd(rows[i].PerekId, i);
        }

        var segments = new List<RecitationSegment>();
        foreach (var group in _viewModel.SelectedPasukim.GroupBy(s => s.PerekId)
            .OrderBy(g => rowOrder.GetValueOrDefault(g.Key, int.MaxValue)))
        {
            var track = RecitationService.Instance.GetTrack(group.Key);
            var pasukim = _viewModel.GetLoadedPasukim(group.Key);
            if (track?.AlignmentStatus != "ready" || pasukim == null || !track.Matches(pasukim))
            {
                continue;
            }

            var ranges = group.OrderBy(s => s.PasukNum)
                .Select(s => track.GetWords(s.PasukNum)).ToList();
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

        await Recitation.PlayPlanAsync(
            $"verses:{string.Join(';', segments.Select(s => s.PerekId))}", continuous: false, segments);
    }

    /// <summary>
    /// Unit playback: the shared planner clips each perek the unit reads to
    /// the range's pasuk bounds via word timings when the track is aligned.
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

        var segments = RecitationRangePlanner.SegmentsForSlices(
            ParashaUnitText.PerekSlicesForUnit(unit),
            _viewModel.GetLoadedPasukim,
            RecitationService.Instance.GetTrack,
            RecitationService.Instance.HasAudio,
            versePause: PreferencesService.Instance.RecitationVersePauseMs >= 0);
        if (segments.Count == 0)
        {
            return;
        }

        await Recitation.PlayPlanAsync($"unit:{unit.UnitId}", continuous: true, segments);
    }

    protected override bool OnBackButtonPressed()
    {
        return TryHandleReaderBack() || base.OnBackButtonPressed();
    }

    private bool TryHandleReaderBack()
    {
        // Topmost transient surfaces own Back first (#2766): fullscreen,
        // then the unit picker and the open fan menu previously fell
        // through to page navigation while still visible.
        if (ExitFullScreenButton.IsVisible)
        { _chrome.ExitFullScreen(); return true; }
        if (ParashaUnitPickerPopup.IsVisible)
        { ParashaUnitPickerPopup.Hide(); return true; }
        if (FanMenu.IsOpen)
        { _ = FanMenu.CloseAsync(); return true; }
        if (ReaderMenuOverlay.IsOpen)
        { ReaderMenuOverlay.Close(); return true; }
        if (PerushimPanel.IsOpen)
        { PerushimPanel.CloseImmediate(); return true; }
        if (ChapterSearch.IsSearchOpen) { ChapterSearch.HandleBack(); return true; }
        // Whatever keeps the selection bar up also owns Back — including a clip
        // playing with nothing selected, which stops instead of navigating.
        if (ReaderSurfaceState.IsActive(_viewModel.SelectedPasukCount, _unitRecitationSelection,
                _focusedPasuk != null, Recitation.Cursor.PlayingKey != null))
        { ClearAllSelections(); return true; }
        return false;
    }
}
