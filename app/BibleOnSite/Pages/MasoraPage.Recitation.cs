using BibleOnSite.Behaviors;
using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.Pages;

/// <summary>
/// Recitation + selection half of <see cref="MasoraPage"/> — the same shared
/// <see cref="ReaderRecitationEngine"/> and <see cref="RecitationRangePlanner"/>
/// the parasha reader uses (#3260). Rows keep canonical (perekId, pasukNum)
/// identity and their unit's clip bounds, so pasuk/word previews and the
/// whole-unit plan read exactly the unit's canonical ranges — including a
/// range that starts or ends mid-verse at a Masoretic break — and never a
/// word outside them.
/// </summary>
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class MasoraPage
#pragma warning restore S2333
{
    private readonly DoubleTapTracker _doubleTap = new();
    private bool _unitRecitationSelection;
    private Pasuk? _focusedPasuk;
    private int _focusedPerekId;
    /// <summary>The focused row's canonical clip start — word indexes stay canonical.</summary>
    private int _focusedClipStart;
    private int _focusedClipEnd = int.MaxValue;
    private CancellationTokenSource? _headerPress;
    private Pasuk? _recitingPasuk;
    private RecitationWord? _recitingWord;
    private readonly Dictionary<int, Span> _focusedWordSpans = [];
    private ReaderRecitationEngine? _recitation;
    private DateTime _lastLongPressTime = DateTime.MinValue;
    private (int PerekId, int PasukNum) _pressedPasuk = (-1, -1);
    private CancellationTokenSource? _longPressTokenSource;
    private const int LongPressDurationMs = 600;
    private DateTime _lastScrollTime = DateTime.MinValue;
    private const int ScrollCooldownMs = 500;

    /// <summary>True while the user is scrolling — suppresses long-press arming.</summary>
    public bool IsScrolling => (DateTime.Now - _lastScrollTime).TotalMilliseconds < ScrollCooldownMs;

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
    /// installed AND the global קריינות preference is enabled.
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

    /// <summary>The display row a highlighted word belongs to, found by its canonical perek.</summary>
    private MasoraPasukRow? FindRecitingRow(int perekId, int pasukNum) =>
        _viewModel.Unit?.Rows.FirstOrDefault(
            row => row.PerekId == perekId && row.PasukNum == pasukNum);

    /// <summary>
    /// Maps the engine's highlighted word onto the displayed row — clipped
    /// rows translate the canonical 1-based segment index into their own
    /// segment list through <see cref="MasoraPasukRow.ClipStartIndex"/>.
    /// </summary>
    private void ApplyRecitingWord(RecitationWord? word)
    {
        var timelinePerekId = Recitation.TimelinePerekId;
        var nextRow = word == null ? null : FindRecitingRow(timelinePerekId, word.Pasuk);
        var nextPasuk = nextRow?.Pasuk;
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
        if (word != null)
        {
            if (nextRow != null)
            {
                nextRow.Pasuk.RecitingSegment = word.Segment - nextRow.ClipStartIndex;
            }
            if (_focusedPasuk?.PasukNum == word.Pasuk && _focusedPerekId == timelinePerekId &&
                _focusedWordSpans.TryGetValue(word.Segment, out var current))
            {
                current.BackgroundColor = Pasuk.RecitingBackgroundDefault;
                current.TextColor = Pasuk.RecitingText;
            }
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
        _focusedClipStart = 0;
        _focusedClipEnd = int.MaxValue;
        _focusedWordSpans.Clear();
        FocusedPasukOverlay.IsVisible = false;
        FocusedPasukOverlay.PerushimSource = null;
        MasoraCarousel.InputTransparent = false;
        AutomationProperties.SetExcludedWithChildren(MasoraCarousel, false);
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
            behavior.AssociatedView?.BindingContext is not MasoraUnit unit || unit != _viewModel.Unit)
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
        var unit = (sender as Label)?.BindingContext as MasoraUnit;
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

    private async Task HandlePasukTapAsync(MasoraPasukRow row)
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
            // קריינות: a single tap plays just this row's clip; a double tap
            // still reaches the focused-pasuk view on the second Tap() call.
            if (CanPlayPasukOnTap(row))
            {
                await PlayPasukRecitationAsync(row);
            }
            return;
        }

        await OpenFocusedPasukAsync(row);
    }

    /// <summary>
    /// Single-tap playback applies only while קריינות is checked and the row's
    /// own perek has downloaded audio.
    /// </summary>
    private bool CanPlayPasukOnTap(MasoraPasukRow row) => _viewModel.IsQriynotEnabled &&
        RecitationService.Instance.HasAudio(row.PerekId);

    /// <summary>
    /// The canonical words a row's unit clip covers — bounded by the same
    /// segment edges the display pasuk was clipped to, so a boundary row never
    /// plays outside its unit.
    /// </summary>
    private static List<RecitationWord> WordsForRow(RecitationTrack track, MasoraPasukRow row) =>
        RecitationRangePlanner.WordsForClippedRow(track, row.PasukNum, row.ClipStartIndex, row.ClipEndIndex);

    /// <summary>
    /// Plays exactly one row's clip — a full pasuk or the unit's clipped
    /// segment span — by bounding the track to its word timings. Requires an
    /// aligned ("ready") track; without word timings there is no boundary to
    /// stop at.
    /// </summary>
    private async Task PlayPasukRecitationAsync(MasoraPasukRow row) =>
        await PlayPasukRecitationAsync(row.PerekId, row.PasukNum, row.ClipStartIndex, row.ClipEndIndex);

    /// <summary>
    /// Plays exactly one row's clip — a full pasuk or the unit's clipped
    /// segment span — by bounding the track to its word timings. Requires an
    /// aligned ("ready") track; without word timings there is no boundary to
    /// stop at.
    /// </summary>
    private async Task PlayPasukRecitationAsync(int perekId, int pasukNum, int clipStart, int clipEnd)
    {
        var track = RecitationService.Instance.GetTrack(perekId);
        if (track?.AlignmentStatus != "ready")
        {
            // Without aligned word timings a row clip has no playback boundary.
            if (track == null)
            {
                await ShellAppNavigator.Instance.DisplayAlertAsync("הקראה", "אין הקלטה לפרק זה", "אישור");
            }
            return;
        }

        var perekPasukim = _viewModel.GetLoadedPasukim(perekId);
        if (perekPasukim == null || !track.Matches(perekPasukim))
        {
            return;
        }

        var words = RecitationRangePlanner.WordsForClippedRow(track, pasukNum, clipStart, clipEnd);
        if (words.Count == 0 || words[0].StartMs == null || words[^1].EndMs == null)
        {
            // A "ready" track missing this row's timings is corrupt pack
            // data — a real failure, reported like other playback failures.
            await ShellAppNavigator.Instance.DisplayAlertAsync("הקראה", "לא ניתן להשמיע את ההקלטה. בדקו את חבילת ההקראה בהעדפות.", "אישור");
            return;
        }

        // Tapping the playing row again goes through the shared toggle; the
        // second tap of a double-tap opens the focused view and keeps it.
        await Recitation.PlayClipAsync($"pasuk:{perekId}:{pasukNum}:{clipStart}", continuous: false,
            new RecitationSegment(perekId, perekPasukim, null, null,
                [(words[0].StartMs!.Value, words[^1].EndMs!.Value)]),
            resumeFromMs: words[0].StartMs!.Value);
    }

    /// <summary>Handles tap on pasuk — toggles selection if in selection mode.</summary>
    private async void OnPasukTapped(object? sender, TappedEventArgs e)
    {
#if ANDROID
        // On Android, taps are handled natively via LongPressBehavior.NativeTapped
        // because MAUI's TapGestureRecognizer fails in nested CarouselView >
        // CollectionView and would also fire after a long-press release.
        await Task.CompletedTask;
        return;
#else
        LongPressBehavior.CancelAllPending();
        if ((DateTime.Now - _lastLongPressTime).TotalMilliseconds < 300)
        {
            return;
        }

        if (e.Parameter is MasoraPasukRow row)
        {
            await HandlePasukTapAsync(row);
        }
#endif
    }

    /// <summary>
    /// Native tap handler fired by LongPressBehavior on Android — MAUI's
    /// TapGestureRecognizer fails inside nested CarouselView > CollectionView
    /// DataTemplates, so taps ride the same native Touch event the long-press
    /// behavior already hooks into.
    /// </summary>
    private async void OnPasukNativeTapped(object? sender, EventArgs e)
    {
        if ((DateTime.Now - _lastLongPressTime).TotalMilliseconds < 300)
        {
            return;
        }

        if (sender is LongPressBehavior behavior &&
            behavior.AssociatedView?.BindingContext is MasoraPasukRow row)
        {
            await HandlePasukTapAsync(row);
        }
    }

    /// <summary>Handles right-click on pasuk — enters selection mode (Windows only).</summary>
    private void OnPasukRightClicked(object? sender, TappedEventArgs e)
    {
#if WINDOWS
        if (e.Parameter is MasoraPasukRow row)
        {
            ResetRecitationContext();
            var wasEmpty = _viewModel.SelectedPasukCount == 0;
            _viewModel.ToggleSelectedPasuk(row.PerekId, row.PasukNum);
            UpdatePasukSelection();
            if (wasEmpty && _viewModel.SelectedPasukCount > 0)
            {
                TriggerHapticFeedback();
            }
        }
#endif
    }

    /// <summary>Handles pointer press — starts the Windows/desktop long-press timer.</summary>
    private void OnPasukPointerPressed(object? sender, PointerEventArgs e)
    {
        if (OperatingSystem.IsAndroid() || OperatingSystem.IsIOS() || OperatingSystem.IsMacCatalyst() || IsScrolling)
        {
            return;
        }

        _longPressTokenSource?.Cancel();
        _longPressTokenSource?.Dispose();
        _longPressTokenSource = new CancellationTokenSource();

        if (sender is Border border && border.BindingContext is MasoraPasukRow row)
        {
            _pressedPasuk = (row.PerekId, row.PasukNum);
            _ = DetectLongPressAsync(_pressedPasuk, _longPressTokenSource.Token);
        }
    }

    /// <summary>Handles pointer release — cancels the long-press timer.</summary>
    private void OnPasukPointerReleased(object? sender, PointerEventArgs e)
    {
        _longPressTokenSource?.Cancel();
        _pressedPasuk = (-1, -1);
    }

    /// <summary>Detects a held pointer past the long-press duration.</summary>
    private async Task DetectLongPressAsync((int PerekId, int PasukNum) pasuk, CancellationToken token)
    {
        try
        {
            await Task.Delay(LongPressDurationMs, token);
            if (!token.IsCancellationRequested && _pressedPasuk == pasuk && !IsScrolling)
            {
                _lastLongPressTime = DateTime.Now;
                ResetRecitationContext();
                var wasEmpty = _viewModel.SelectedPasukCount == 0;
                _viewModel.ToggleSelectedPasuk(pasuk.PerekId, pasuk.PasukNum);
                MainThread.BeginInvokeOnMainThread(() =>
                {
                    UpdateSelectionBar();
                    if (wasEmpty && _viewModel.SelectedPasukCount > 0)
                    {
                        TriggerHapticFeedback();
                    }
                });
            }
        }
        catch (TaskCanceledException)
        {
            // Press was released before long press duration — ignore.
        }
    }

    /// <summary>Handles long press on pasuk via LongPressBehavior — enters selection mode.</summary>
    private void OnPasukLongPressed(object? sender, EventArgs e)
    {
#if ANDROID || IOS || MACCATALYST
        _lastLongPressTime = DateTime.Now;
        if (sender is LongPressBehavior behavior &&
            behavior.AssociatedView?.BindingContext is MasoraPasukRow row)
        {
            ResetRecitationContext();
            var wasEmpty = _viewModel.SelectedPasukCount == 0;
            _viewModel.ToggleSelectedPasuk(row.PerekId, row.PasukNum);
            UpdateSelectionBar();
            if (wasEmpty && _viewModel.SelectedPasukCount > 0)
            {
                TriggerHapticFeedback();
            }
        }
#endif
    }

    /// <summary>Tracks scroll events to prevent long-press during scroll.</summary>
    private void OnPasukimScrolled(object? sender, ItemsViewScrolledEventArgs e)
    {
        _doubleTap.Reset();
        _lastScrollTime = DateTime.Now;
        _longPressTokenSource?.Cancel();
        _pressedPasuk = (-1, -1);
#if !ANDROID
        LongPressBehavior.CancelAllPending();
#endif
    }

    private async void OnPasukDoubleTapped(object? sender, TappedEventArgs e)
    {
#if !ANDROID
        if (_viewModel.SelectedPasukCount == 0 && e.Parameter is MasoraPasukRow row)
        {
            await OpenFocusedPasukAsync(row);
        }
#else
        await Task.CompletedTask;
#endif
    }

    private async Task OpenFocusedPasukAsync(MasoraPasukRow row)
    {
        var pasuk = row.Pasuk;
        if (_focusedPasuk == pasuk && _focusedPerekId == row.PerekId)
        {
            return;
        }

        // A row preview that is still playing keeps playing into the focused
        // view — its words highlight there live and the bar can pause it.
        ResetRecitationContext(stopPlayback: false);
        _focusedPasuk = pasuk;
        _focusedPerekId = row.PerekId;
        _focusedClipStart = row.ClipStartIndex;
        _focusedClipEnd = row.ClipEndIndex;
        // A double tap's first press paused this row's preview through the
        // shared toggle — opening its focused view resumes it.
        if (_recitation?.PlayerState is RecitationPlaybackState.Playing or RecitationPlaybackState.Paused &&
            Recitation.Cursor.ResumesOnPasukFocus($"pasuk:{row.PerekId}:{row.PasukNum}",
                _recitation.PlayerState == RecitationPlaybackState.Playing))
        {
            Recitation.ResumePlayback();
        }
        else if (RecitationAvailable &&
            Recitation.Cursor.PlayingKey != $"pasuk:{row.PerekId}:{row.PasukNum}:{row.ClipStartIndex}" &&
            CanPlayFocusedPasuk)
        {
            _ = PlayPasukRecitationAsync(row);
        }
        // The מסורה reader keeps canonical perek apparatus hidden — the
        // focused view names the unit, not a perek/pasuk coordinate.
        FocusedPasukOverlay.SourceText = _viewModel.Heading;
        FocusedPasukOverlay.IsVisible = true;
        MasoraCarousel.InputTransparent = true;
        AutomationProperties.SetExcludedWithChildren(MasoraCarousel, true);
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
                    // Display masking only — word/segment indexes stay canonical
                    // so tapped-word recitation keeps its timing alignment.
                    _ => DivineNameMasking.MaskText(segment.Value)
                }
            };
            // The focused pasuk is the row's clipped segment list — a word's
            // canonical 1-based index is the clipped index + the clip start.
            var word = track!.GetWord(pasuk.PasukNum, i + 1 + _focusedClipStart);
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
    /// The focused-view headphones action plays the row's unit clip — offered
    /// while the perek track can bound it (timings ready).
    /// </summary>
    private bool CanPlayFocusedPasuk => _focusedPasuk != null && _focusedPerekId > 0 &&
        RecitationAvailable &&
        RecitationService.Instance.GetTrack(_focusedPerekId) is { AlignmentStatus: "ready" } focusedTrack &&
        _viewModel.GetLoadedPasukim(_focusedPerekId) is { } focusedPasukim &&
        focusedTrack.Matches(focusedPasukim) &&
        RecitationRangePlanner.WordsForClippedRow(focusedTrack, _focusedPasuk.PasukNum,
            _focusedClipStart, _focusedClipEnd).Any(w => w.StartMs != null && w.EndMs != null);

    private async void OnFocusedPlayClicked(object? sender, EventArgs e)
    {
        if (_focusedPasuk != null && _focusedPerekId > 0)
        {
            await PlayPasukRecitationAsync(_focusedPerekId, _focusedPasuk.PasukNum,
                _focusedClipStart, _focusedClipEnd);
        }
    }

    /// <summary>Whether every selected row's perek track can bound a verses clip.</summary>
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
        MasoraUnitText.PerekIdsForUnit(unit).Any(id => RecitationService.Instance.HasAudio(id));

    private async void OnSelectionRecitationClicked(object? sender, EventArgs e)
    {
        // Playback the recitation controls themselves issued toggles pause and
        // resume — a tapped word preview is a bookmark, not the bar's playback
        // (#2157), so Play during one starts unit playback at that word instead.
        if (Recitation.Cursor.BarIssued && Recitation.ToggleBarPlayback())
        {
            return;
        }
        if (_viewModel.Unit is null)
        {
            return;
        }

        if (_unitRecitationSelection || Recitation.Cursor.PlayingKey != null ||
            (_focusedPasuk == null && _viewModel.SelectedPasukim.Count == 0))
        {
            await PlayUnitRecitationAsync();
            return;
        }

        if (_focusedPasuk != null && _focusedPerekId > 0)
        {
            OnFocusedPlayClicked(sender, e);
            return;
        }

        // Selected rows keep their unit clip bounds and the reader's row
        // order; each perek's rows become one chained verses clip. Groups
        // order by the perek's first row — GroupBy's tap order would play a
        // later perek selected first ahead of an earlier reading.
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

            var selected = new HashSet<int>(group.Select(s => s.PasukNum));
            var ranges = rows
                .Where(row => row.PerekId == group.Key && selected.Contains(row.PasukNum))
                .Select(row => WordsForRow(track, row))
                .ToList();
            if (ranges.Count == 0 || ranges.Any(r => r.Count == 0))
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
    /// Unit playback: the shared planner clips each perek the unit's ordered
    /// canonical ranges cover to its pasuk/segment bounds via word timings
    /// when the track is aligned — including mid-verse Masoretic break edges.
    /// </summary>
    private async Task PlayUnitRecitationAsync()
    {
        if (_viewModel.Unit is not { } unit)
        {
            return;
        }

        var segments = RecitationRangePlanner.SegmentsForSlices(
            MasoraUnitText.PerekSlicesForUnit(unit),
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

    /// <summary>Updates the selection bar after selection change.</summary>
    private void UpdatePasukSelection() => UpdateSelectionBar();

    private void UpdateSelectionBar()
    {
        if (_viewModel == null)
        {
            return;
        }

        var count = _viewModel.SelectedPasukCount;
        var focused = _focusedPasuk != null;
        var isSelectionMode = ReaderSurfaceState.ShowsSelectionBar(count, _unitRecitationSelection,
            focused, Recitation.Cursor.PlayingKey != null);
        var ordinarySelection = count > 0 && !_unitRecitationSelection && _focusedPasuk == null;
        SelectionBar.SetSelectionActionsVisible(ordinarySelection);
        SelectionBar.SetRecitationVisible(RecitationAvailable);
        var recitationEnabled = !Recitation.Busy && _viewModel.Unit != null &&
            (Recitation.Cursor.PlayingKey != null || _unitRecitationSelection || CanPlayFocusedPasuk ||
                CanPlaySelectedPasukim());
        var recitationVisual =
            RecitationPlayerState == RecitationPlaybackState.Playing && Recitation.Cursor.BarIssued
                ? ReaderSelectionBar.RecitationVisual.Pause
                : RecitationPlayerState is RecitationPlaybackState.Playing or RecitationPlaybackState.Paused
                    ? ReaderSelectionBar.RecitationVisual.Resume : ReaderSelectionBar.RecitationVisual.Play;
        var hint = Recitation.Busy ? "טוען את הקלטת הפרשה..." :
            !_viewModel.HasCurrentUnitRecitation ? "אין הקלטה לפרשה זו - הורידו את הקלטות הספר בהעדפות" :
            recitationEnabled ? "הקראה" : "הקראת מילים ופסוקים אינה זמינה";
        SelectionBar.SetRecitationState(recitationEnabled, recitationVisual, hint);

        Shell.SetNavBarIsVisible(this, false);
        ReaderToolbar.IsVisible = !ExitFullScreenButton.IsVisible;
        (Shell.Current as AppShell)?.SetPageNavHidden(this, isSelectionMode);
        Shell.SetBackButtonBehavior(this, new BackButtonBehavior { IsVisible = true });
        if (isSelectionMode)
        {
            var primary = (Color)Microsoft.Maui.Controls.Application.Current!.Resources["Primary"];
            Shell.SetBackgroundColor(this, primary);
            ReaderToolbar.BackgroundColor = primary;
        }
        else
        {
            this.SetAppThemeColor(Shell.BackgroundColorProperty, SharedTopBar.BandLight, SharedTopBar.BandDark);
            ReaderToolbar.SetAppThemeColor(VisualElement.BackgroundColorProperty, SharedTopBar.BandLight, SharedTopBar.BandDark);
        }
        NormalNavigationBar.BarVisible = !isSelectionMode;
        NormalNavigationBar.RefreshBackState();
        SelectionBar.IsVisible = isSelectionMode;
        SelectionBar.SetCount(count);
    }

    private void ClearAllSelections()
    {
        // Closing the focused pasuk keeps playback going (the bar is still
        // visible); leaving selection or unit mode stops it.
        ResetRecitationContext(stopPlayback: _focusedPasuk == null);
        _viewModel.ClearSelected();
        UpdateSelectionBar();
    }

    private void OnSelectionBackClicked(object? sender, EventArgs e)
    {
        ClearAllSelections();
    }

    private async void OnSelectionShareClicked(object? sender, EventArgs e)
    {
        var text = GetSelectedPesukimText();
        if (!string.IsNullOrEmpty(text))
        {
            await Share.RequestAsync(new ShareTextRequest { Text = text, Title = _viewModel.Heading });
        }
    }

    private async void OnSelectionCopyClicked(object? sender, EventArgs e)
    {
        var text = GetSelectedPesukimText();
        if (string.IsNullOrEmpty(text))
        {
            return;
        }

        await Clipboard.SetTextAsync(text);
        TriggerHapticFeedback();
        // Inline feedback: the bar flashes the clipboard-checkmark glyph.
        await SelectionBar.FlashCopiedAsync();
    }

    private string GetSelectedPesukimText()
    {
        var selected = _viewModel.GetSelectedPesukim();
        if (selected.Count == 0)
        {
            return string.Empty;
        }

        // The מסורה reader hides chapter apparatus from its UI; shared text
        // still names each pasuk's canonical source for the recipient.
        var lines = selected.Select(item =>
            $"{PerekDataService.Instance.GetPerekSource(item.PerekId) ?? string.Empty} {item.Pasuk.PasukNumHeb}. {item.Pasuk.Text}");
        return $"{_viewModel.Heading}\n\n{string.Join("\n", lines)}";
    }

    /// <summary>Triggers haptic feedback (vibration) for selection mode entry.</summary>
    private static void TriggerHapticFeedback()
    {
        try
        {
#if ANDROID
            Vibration.Vibrate(TimeSpan.FromMilliseconds(50));
#elif IOS
            HapticFeedback.Perform(HapticFeedbackType.LongPress);
#endif
        }
        #pragma warning disable S2221 // Deliberate failure boundary: haptic feedback is best-effort
        catch (Exception ex) //NOSONAR — haptic feedback is best-effort.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Haptic feedback failed: {ex.Message}");
        }
    }
}
