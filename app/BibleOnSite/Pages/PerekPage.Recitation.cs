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
    private WebAudioRecitationDecoder? _audioDecoder;
    private bool RecitationEnabled => PreferencesService.Instance.RecitationEnabled && RecitationService.Instance.IsInstalled;

    private void SubscribeRecitation()
    {
        PreferencesService.Instance.PreferencesChanged += OnRecitationPreferencesChanged;
        RecitationService.Instance.Changed += OnRecitationPackageChanged;
        RecitationService.Instance.PlaybackStopRequested += OnPlaybackStopRequested;
    }

    private async Task InitializeRecitationAsync()
    {
        try { await RecitationService.Instance.InitializeAsync(); UpdateSelectionBar(); _ = RecitationService.Instance.RefreshIfStaleAsync(); }
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
        RefreshFocusedRecitation(); UpdateSelectionBar();
    });
    private void OnPlaybackStopRequested(object? sender, EventArgs e) => Dispatcher.Dispatch(() => { StopRecitation(); UpdateSelectionBar(); });

    private void StopRecitation()
    {
        _recitationRequest?.Cancel();
        _playWhenOpened = false;
        _playingKey = null;
        _recitationBusy = false;
        if (RecitationPlayer.Source != null)
        {
            RecitationPlayer.Stop();
        }

        RecitationPlayer.Source = null;
    }

    private void ResetRecitationContext()
    {
        StopRecitation();
        _doubleTap.Reset();
        _headerPress?.Cancel();
        _chapterRecitationSelection = false;
        _focusedPasuk = null;
        FocusedPasukOverlay.IsVisible = false;
        PerekCarousel.InputTransparent = false;
        AutomationProperties.SetExcludedWithChildren(PerekCarousel, false);
        if (_audioDecoder != null)
        {
            _ = _audioDecoder.ReleaseAsync();
        }
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
        finally { if (_headerPress == request)
            {
                _headerPress = null;
            }
        }
    }
    private void OnHeaderPointerReleased(object? sender, PointerEventArgs e) => _headerPress?.Cancel();
    private void OnHeaderPointerMoved(object? sender, PointerEventArgs e) => _headerPress?.Cancel();

    private async Task HandlePasukTapAsync(Pasuk pasuk, object? view)
    {
        if (_viewModel.SelectedPasukNums.Count > 0)
        {
            StopRecitation();
            _doubleTap.Reset();
            _viewModel.ToggleSelectedPasuk(pasuk.PasukNum);
            UpdatePasukSelection(view, pasuk.PasukNum);
            return;
        }
        if (!_doubleTap.Tap(_viewModel.PerekId, pasuk.PasukNum, Environment.TickCount64))
        {
            return;
        }

        await OpenFocusedPasukAsync(pasuk);
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

            var span = new Span { Text = segment.Type switch
            {
                SegmentType.Ptuha => " {פ} ", SegmentType.Stuma => " {ס} ", _ => segment.Value
            }};
            var word = track!.Words.FirstOrDefault(w => w.Pasuk == pasuk.PasukNum && w.Segment == i + 1);
            if (word != null)
            {
                span.TextColor = Color.FromArgb("#637598");
                var tap = new TapGestureRecognizer();
                tap.Tapped += async (_, _) => await PlayRecitationAsync($"word:{perek.PerekId}:{word.Pasuk}:{word.Segment}", word.StartMs, word.EndMs);
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
        if (_playingKey != null && RecitationPlayer.CurrentState is MediaElementState.Playing or MediaElementState.Paused)
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
        if (_chapterRecitationSelection)
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
        IReadOnlyList<(double Start, double End)>? ranges = null)
    {
        if (!RecitationEnabled || _viewModel.Perek is not { } perek)
        {
            return;
        }

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
            _audioDecoder ??= new WebAudioRecitationDecoder(RecitationDecoderView);
            var path = await RecitationService.Instance.PrepareAudioAsync(perek.PerekId, perek.Pasukim, start, end, request.Token, ranges, _audioDecoder);
            if (request.IsCancellationRequested || _viewModel.Perek != perek || !RecitationEnabled)
            {
                return;
            }

            _playingKey = key;
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

    private void OnRecitationMediaOpened(object? sender, EventArgs e)
    {
        if (_playWhenOpened && RecitationEnabled) { _playWhenOpened = false; RecitationPlayer.Play(); }
    }
    private void OnRecitationMediaEnded(object? sender, EventArgs e) { _playingKey = null; UpdateSelectionBar(); }
    private void OnRecitationStateChanged(object? sender, MediaStateChangedEventArgs e) => UpdateSelectionBar();
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
        if (_focusedPasuk != null || _chapterRecitationSelection || _viewModel.SelectedPasukNums.Count > 0)
        { ClearAllSelections(); return true; }
        return base.OnBackButtonPressed();
    }
}
