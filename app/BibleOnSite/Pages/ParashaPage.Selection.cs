namespace BibleOnSite.Pages;

using BibleOnSite.Behaviors;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;

/// <summary>
/// Pasuk selection half of <see cref="ParashaPage"/> — tap/double-tap/
/// long-press handling, the selection bar with copy/share/recitation,
/// and the focused-pasuk overlay. Canonical (perekId, pasukNum) keys
/// keep selections stable across the unit's perek boundaries and
/// שניים מקרא copies.
/// </summary>
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class ParashaPage
#pragma warning restore S2333
{
    private DateTime _lastLongPressTime = DateTime.MinValue;
    private (int PerekId, int PasukNum) _pressedPasuk = (-1, -1);
    private CancellationTokenSource? _longPressTokenSource;
    private const int LongPressDurationMs = 600;

    // Scroll state tracking - used to prevent long-press during scroll
    private DateTime _lastScrollTime = DateTime.MinValue;
    private const int ScrollCooldownMs = 500; // Don't allow long-press within 500ms of scroll

    /// <summary>
    /// True while the user is scrolling or just finished — used by
    /// LongPressBehavior to prevent false triggers during scroll.
    /// </summary>
    public bool IsScrolling => (DateTime.Now - _lastScrollTime).TotalMilliseconds < ScrollCooldownMs;

    /// <summary>Tracks scroll events to prevent long-press during scroll.</summary>
    private void OnPasukimScrolled(object? sender, ItemsViewScrolledEventArgs e)
    {
        _doubleTap.Reset();
        _lastScrollTime = DateTime.Now;
        _longPressTokenSource?.Cancel();
        _pressedPasuk = (-1, -1);
#if !ANDROID
        // Android cancels the active press once its own touch moves beyond slop.
        // A scroll event from a previous fling must not cancel a new hold, and
        // walking every verse behavior on every scroll frame causes jank.
        LongPressBehavior.CancelAllPending();
#endif
    }

    /// <summary>Handles tap on pasuk - toggles selection if in selection mode.</summary>
    private async void OnPasukTapped(object? sender, TappedEventArgs e)
    {
        if (ChapterSearch.IsSearchOpen)
        {
            ChapterSearch.Close();
            return;
        }
#if ANDROID
        // On Android, taps are handled natively via LongPressBehavior.NativeTapped
        // because (a) MAUI's TapGestureRecognizer fails in nested CarouselView >
        // CollectionView and (b) with e.Handled=true on Down the MAUI gesture also
        // fires after a long-press release, immediately undoing the selection.
        await Task.CompletedTask;
        return;
#else
        // Cancel any pending long-press timers
        LongPressBehavior.CancelAllPending();

        // Skip tap if long press just happened (prevents tap-on-release from toggling selection off)
        if ((DateTime.Now - _lastLongPressTime).TotalMilliseconds < 300)
        {
            return;
        }

        if (e.Parameter is ParashaDisplayItem row)
        {
            await HandlePasukTapAsync(row);
        }
#endif
    }

    /// <summary>
    /// Native tap handler fired by LongPressBehavior on Android.
    /// MAUI's TapGestureRecognizer fails inside nested CarouselView > CollectionView
    /// DataTemplates, so we detect taps via the same native Touch event that the
    /// long-press behavior already hooks into.
    /// </summary>
    private async void OnPasukNativeTapped(object? sender, EventArgs e)
    {
        if (ChapterSearch.IsSearchOpen)
        {
            ChapterSearch.Close();
            return;
        }
        // Skip tap if long press just happened
        if ((DateTime.Now - _lastLongPressTime).TotalMilliseconds < 300)
        {
            return;
        }

        if (sender is LongPressBehavior behavior &&
            behavior.AssociatedView?.BindingContext is ParashaDisplayItem row && row.Display != null)
        {
            await HandlePasukTapAsync(row);
        }
    }

    /// <summary>Handles right-click on pasuk - enters selection mode (Windows only).</summary>
    private void OnPasukRightClicked(object? sender, TappedEventArgs e)
    {
#if WINDOWS
        if (e.Parameter is ParashaDisplayItem row && row.Display != null)
        {
            // Don't set _lastLongPressTime - right-click doesn't need debounce
            ResetRecitationContext();
            var wasEmpty = _viewModel.SelectedPasukCount == 0;
            _viewModel.ToggleSelectedPasuk(row.PerekId, row.PasukNum);
            UpdatePasukSelection();
            // Vibrate when entering selection mode
            if (wasEmpty && _viewModel.SelectedPasukCount > 0)
            {
                TriggerHapticFeedback();
            }
        }
#endif
    }

    /// <summary>Handles pointer press - starts long-press timer.</summary>
    private void OnPasukPointerPressed(object? sender, PointerEventArgs e)
    {
        // Mobile platforms use native long-press recognition.
        if (OperatingSystem.IsAndroid() || OperatingSystem.IsIOS() || OperatingSystem.IsMacCatalyst())
        {
            return;
        }

        // Don't start long-press detection if scrolling
        if (IsScrolling)
        {
            return;
        }

        _longPressTokenSource?.Cancel();
        _longPressTokenSource?.Dispose();
        _longPressTokenSource = new CancellationTokenSource();

        if (sender is Border border && border.BindingContext is ParashaDisplayItem row && row.Display != null)
        {
            _pressedPasuk = (row.PerekId, row.PasukNum);
            _ = DetectLongPressAsync(_pressedPasuk, _longPressTokenSource.Token);
        }
    }

    /// <summary>Handles pointer release - cancels long-press timer.</summary>
    private void OnPasukPointerReleased(object? sender, PointerEventArgs e)
    {
        _longPressTokenSource?.Cancel();
        _pressedPasuk = (-1, -1);
    }

    /// <summary>Detects long press after duration.</summary>
    private async Task DetectLongPressAsync((int PerekId, int PasukNum) pasuk, CancellationToken token)
    {
        try
        {
            await Task.Delay(LongPressDurationMs, token);

            // If we get here, the press was held long enough
            // Double-check we're not scrolling and pasuk is still pressed
            if (!token.IsCancellationRequested && _pressedPasuk == pasuk && !IsScrolling)
            {
                _lastLongPressTime = DateTime.Now;

                ResetRecitationContext();
                var wasEmpty = _viewModel.SelectedPasukCount == 0;
                _viewModel.ToggleSelectedPasuk(pasuk.PerekId, pasuk.PasukNum);

                // Must run on UI thread
                MainThread.BeginInvokeOnMainThread(() =>
                {
                    UpdateSelectionBar();
                    // Vibrate when entering selection mode
                    if (wasEmpty && _viewModel.SelectedPasukCount > 0)
                    {
                        TriggerHapticFeedback();
                    }
                });
            }
        }
        catch (TaskCanceledException)
        {
            // Press was released before long press duration - ignore
        }
    }

    /// <summary>Handles long press on pasuk via custom LongPressBehavior - enters selection mode.</summary>
    private void OnPasukLongPressed(object? sender, EventArgs e)
    {
#if ANDROID || IOS || MACCATALYST
        _lastLongPressTime = DateTime.Now;

        // The sender is the LongPressBehavior - get the row from the associated view's BindingContext
        if (sender is LongPressBehavior behavior &&
            behavior.AssociatedView?.BindingContext is ParashaDisplayItem row && row.Display != null)
        {
            ResetRecitationContext();
            var wasEmpty = _viewModel.SelectedPasukCount == 0;
            _viewModel.ToggleSelectedPasuk(row.PerekId, row.PasukNum);
            UpdateSelectionBar();
            // Vibrate when entering selection mode
            if (wasEmpty && _viewModel.SelectedPasukCount > 0)
            {
                TriggerHapticFeedback();
            }
        }
#endif
    }

    /// <summary>Updates the selection bar after selection change.</summary>
    private void UpdatePasukSelection() => UpdateSelectionBar();

    #region Selection Bar Methods

    private void UpdateSelectionBar()
    {
        if (_viewModel == null)
        {
            return;
        }

        var count = _viewModel.SelectedPasukCount;
        var focused = _focusedPasuk != null;
        // The focused pasuk keeps the shared reader toolbar (full pasuk source,
        // scoped search, #2466); the Back-only selection bar is for the other
        // transient surfaces — a pesukim selection, the unit recitation mode,
        // or an in-flight clip with no focused pasuk (#2370). The IsActive set
        // still owns the Android Back press (TryHandleReaderBack) — both read
        // their answer from ReaderSurfaceState.
        var isSelectionMode = ReaderSurfaceState.ShowsSelectionBar(count, _unitRecitationSelection,
            focused, _recitationCursor.PlayingKey != null);
        ChapterSearch.SetFocusedPasukScope(focused);
        var ordinarySelection = count > 0 && !_unitRecitationSelection && _focusedPasuk == null;
        SelectionCountBadge.IsVisible = ordinarySelection;
        SelectionShareButton.IsVisible = ordinarySelection;
        SelectionCopyButton.IsVisible = ordinarySelection;
        SelectionRecitationButton.IsVisible = RecitationAvailable;
        // An active playback can always be paused — even while more of the
        // unit's tracks are still pending alignment.
        SelectionRecitationButton.IsEnabled = !_recitationBusy && _viewModel.Unit != null &&
            (_recitationCursor.PlayingKey != null || _unitRecitationSelection || CanPlayFocusedPasuk ||
                CanPlaySelectedPasukim());
        SelectionRecitationButton.Opacity = SelectionRecitationButton.IsEnabled ? 1 : 0.4;
        // The glyph must match what the button does: only bar-issued playback
        // pauses, so a word preview still playing shows Play (it starts the
        // unit at the bookmark), like the website's preview state.
        SelectionRecitationButton.Text =
            RecitationPlayer?.CurrentState == CommunityToolkit.Maui.Core.MediaElementState.Playing && _recitationCursor.BarIssued
                ? Fonts.FluentUI.pause_24_regular
                : RecitationPlayer?.CurrentState is CommunityToolkit.Maui.Core.MediaElementState.Playing or CommunityToolkit.Maui.Core.MediaElementState.Paused
                    ? Fonts.FluentUI.play_24_regular : Fonts.FluentUI.headphones_24_regular;
        var hint = _recitationBusy ? "טוען את הקלטת הפרשה..." :
            !_viewModel.HasCurrentUnitRecitation ? "אין הקלטה לפרשה זו — הורידו את הקלטות הספר בהעדפות" :
            SelectionRecitationButton.IsEnabled ? "הקראה" : "הקראת מילים ופסוקים עדיין בהכנה";
        ToolTipProperties.SetText(SelectionRecitationButton, hint);
        SemanticProperties.SetDescription(SelectionRecitationButton, hint);

        var searching = ChapterSearch.IsSearchOpen;
        Shell.SetNavBarIsVisible(this, false);
        ReaderToolbar.IsVisible = !ExitFullScreenButton.IsVisible;
        Shell.SetFlyoutBehavior(this, isSelectionMode || searching ? FlyoutBehavior.Disabled : FlyoutBehavior.Flyout);
        Shell.SetBackButtonBehavior(this, new BackButtonBehavior { IsVisible = !searching });
        var shellBackground = isSelectionMode
            ? (Color)Microsoft.Maui.Controls.Application.Current!.Resources["Primary"]
            : Microsoft.Maui.Controls.Application.Current!.RequestedTheme == AppTheme.Dark
                ? Color.FromArgb("#20304A")
                : Color.FromArgb("#F2F7FE");
        Shell.SetBackgroundColor(this, shellBackground);
        ReaderToolbar.BackgroundColor = shellBackground;
        NormalNavigationBar.BarVisible = !isSelectionMode && !searching;
        // The header names the focused pasuk — its perek source and pasuk
        // together — instead of the plain unit title (#2466).
        NormalNavigationTitle.Text = focused && _focusedPerekId > 0
            ? $"{PerekDataService.Instance.GetPerekSource(_focusedPerekId)} {_focusedPasuk!.PasukNumHeb}"
            : _viewModel.Title;
        // iOS has no system Back for the overlay, so the navigation slot turns
        // into the close control there; platforms with system Back keep the
        // shared hamburger (#2467).
        var focusedNavIsBack = focused && (OperatingSystem.IsIOS() || OperatingSystem.IsMacCatalyst());
        NormalNavigationBar.NavigationButton.Text = focusedNavIsBack
            ? Fonts.FluentUI.arrow_right_24_regular
            : Fonts.FluentUI.navigation_24_regular;
        SemanticProperties.SetDescription(NormalNavigationBar.NavigationButton,
            focusedNavIsBack ? "סגירת הפסוק הממוקד" : "פתיחת תפריט הניווט");
        SearchTitleHost.IsVisible = searching;
        SearchTitleHost.Content = searching ? _searchHeader : null;
        ChapterSearch.IsVisible = searching;
        ContentArea.IsVisible = !searching;
        SelectionBar.IsVisible = isSelectionMode && !searching;
        SelectionCountLabel.Text = count.ToString();
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
            await Share.RequestAsync(new ShareTextRequest { Text = text, Title = _viewModel.Title });
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
        // Inline feedback: show clipboard-checkmark icon for 1.5s then restore copy icon
        SelectionCopyButton.Text = "\ue34c"; // clipboard_checkmark_24_regular
        await Task.Delay(1500);
        SelectionCopyButton.Text = "\uf32b"; // copy_24_regular
    }

    private string GetSelectedPesukimText()
    {
        var selected = _viewModel.GetSelectedPesukim();
        if (selected.Count == 0)
        {
            return string.Empty;
        }

        // Canonical (perekId, pasukNum) order follows the row order — the
        // unit's Torah section first, then each Haftarah variant.
        var lines = selected.Select(item =>
        {
            var source = _viewModel.Unit?.Rows.FirstOrDefault(
                row => row.PerekId == item.PerekId && row.Display != null)?.Display == null
                ? string.Empty
                : PerekDataService.Instance.GetPerekSource(item.PerekId) ?? string.Empty;
            return $"{source} {item.Pasuk.PasukNumHeb}. {item.Pasuk.Text}";
        });
        return $"{_viewModel.Title}\n\n{string.Join("\n", lines)}";
    }

    #endregion

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
