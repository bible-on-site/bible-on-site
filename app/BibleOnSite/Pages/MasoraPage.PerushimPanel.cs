using BibleOnSite.Models;

namespace BibleOnSite.Pages;

/// <summary>
/// Perushim bottom-panel half of <see cref="MasoraPage"/> — the slide-up
/// commentary panel, its pan-to-dismiss/expand gesture, and the checkbox
/// toggle pipeline (same split pattern as PerekPage's partial files).
/// </summary>
// Codacy: S2333 false positive — partial is required by the XAML code
// generator and by the xaml.cs partial part.
#pragma warning disable S2333
public partial class MasoraPage //NOSONAR
#pragma warning restore S2333
{
    private bool _isPerushimOpen;
    private bool _isPerushimExpanded;
    private double _perushimPanelHeight;
    private double _perushimPanelExpandedHeight;
    private double _perushimPanStartHeight;
    private double _perushimLastPanY;
    private DateTime _perushimLastPanTime;

    private bool _isTogglingPerush;

    private void OnPerushCheckboxChanged(object? sender, CheckedChangedEventArgs e)
    {
        if (_isTogglingPerush)
        {
            return;
        }
        if (sender is not CheckBox checkBox)
        {
            return;
        }
        var grid = checkBox.Parent as Grid;
        var perush = grid?.BindingContext as Perush;
        if (perush == null)
        {
            return;
        }

        bool wantChecked = e.Value;
        bool alreadyChecked = _viewModel.IsPerushChecked(perush.Id);
        if (wantChecked == alreadyChecked)
        {
            return;
        }

        _isTogglingPerush = true;
        try
        {
            _viewModel.ToggleCheckedPerush(perush.Id);
            checkBox.IsChecked = _viewModel.IsPerushChecked(perush.Id);
        }
        finally
        {
            _isTogglingPerush = false;
        }
    }

    /// <summary>
    /// Perushim search navigates instead of filtering — the full list stays
    /// visible and each keystroke scrolls the first matching perush into view.
    /// </summary>
    private void SubscribePerushimSearch()
    {
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(MasoraViewModel.PerushNameFilter) && _isPerushimOpen)
            {
                var match = _viewModel.FilteredPerushim.FirstOrDefault();
                if (match != null)
                {
                    PerushimCollection.ScrollTo(match, position: ScrollToPosition.Start, animate: false);
                }
            }
        };
    }

    private async void OnGoToPerushimSettingsClicked(object? sender, EventArgs e)
    {
        try
        {
            await Shell.Current.GoToAsync("PreferencesPage");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Navigate to perushim settings failed: {ex}");
        }
    }

    private async void OnPerushimChevronClicked(object? sender, EventArgs e)
    {
        _isPerushimOpen = !_isPerushimOpen;
        _isPerushimExpanded = false;

        // Toggle chevron icon: down (open) vs up (closed)
        PerushimChevronButton.Text = _isPerushimOpen
            ? Fonts.FluentUI.chevron_down_24_regular
            : Fonts.FluentUI.chevron_up_24_regular;

        // Calculate panel heights
        var totalHeight = MainGrid.Height;
        _perushimPanelHeight = (totalHeight * 0.33) + 90; // Default: 33% + bottom bar
        // Cap the drag-up expansion so the sheet's top edge stays under the
        // status bar/pill: content + toolbar rows already begin below it.
        var toolbarHeight = ReaderToolbar.IsVisible ? ReaderToolbar.Height : 0;
        _perushimPanelExpandedHeight = Math.Max(_perushimPanelHeight,
            ContentArea.Height + toolbarHeight - 8);

        if (_isPerushimOpen)
        {
            PerushimPanel.HeightRequest = _perushimPanelHeight;
            PerushimPanel.TranslationY = _perushimPanelHeight;
            PerushimPanel.IsVisible = true;

            await PerushimPanel.TranslateToAsync(0, 0, 250, Easing.CubicOut);
        }
        else
        {
            await PerushimPanel.TranslateToAsync(0, _perushimPanelHeight, 250, Easing.CubicIn);
            PerushimPanel.IsVisible = false;
        }
    }

    /// <summary>
    /// Handles pan gesture on the perushim panel header for drag-to-dismiss or expand.
    /// </summary>
    private async void OnPerushimPanelPan(object? sender, PanUpdatedEventArgs e)
    {
        if (!_isPerushimOpen)
        {
            return;
        }

        const double dismissThreshold = 0.3;
        const double velocityThreshold = 800;

        switch (e.StatusType)
        {
            case GestureStatus.Started:
                _perushimPanStartHeight = PerushimPanel.HeightRequest;
                _perushimLastPanY = 0;
                _perushimLastPanTime = DateTime.Now;
                PerushimPanel.CancelAnimations();
                break;

            case GestureStatus.Running:
                _perushimLastPanY = e.TotalY;
                _perushimLastPanTime = DateTime.Now;

                if (e.TotalY > 0)
                {
                    if (_isPerushimExpanded)
                    {
                        var newHeight = Math.Max(_perushimPanelHeight,
                            _perushimPanStartHeight - e.TotalY);
                        PerushimPanel.HeightRequest = newHeight;
                    }
                    else
                    {
                        PerushimPanel.TranslationY = e.TotalY;
                    }
                }
                else
                {
                    var newHeight = Math.Min(_perushimPanelExpandedHeight,
                        _perushimPanStartHeight - e.TotalY);
                    PerushimPanel.HeightRequest = newHeight;
                }
                break;

            case GestureStatus.Completed:
            case GestureStatus.Canceled:
                var elapsedMs = (DateTime.Now - _perushimLastPanTime).TotalMilliseconds;
                var velocity = elapsedMs > 0 ? Math.Abs(_perushimLastPanY) / (elapsedMs / 1000.0) : 0;

                var dragY = PerushimPanel.TranslationY;
                var currentHeight = PerushimPanel.HeightRequest;

                if (_perushimLastPanY > 0)
                {
                    if (_isPerushimExpanded)
                    {
                        var collapseThreshold = (_perushimPanelExpandedHeight - _perushimPanelHeight) * dismissThreshold;
                        var heightDecrease = _perushimPanStartHeight - currentHeight;
                        var shouldCollapse = heightDecrease > collapseThreshold || velocity > velocityThreshold;

                        if (shouldCollapse)
                        {
                            _isPerushimExpanded = false;
                            var animation = new Animation(v => PerushimPanel.HeightRequest = v,
                                currentHeight, _perushimPanelHeight);
                            animation.Commit(PerushimPanel, "CollapsePerushim", length: 200, easing: Easing.CubicOut);
                        }
                        else
                        {
                            var animation = new Animation(v => PerushimPanel.HeightRequest = v,
                                currentHeight, _perushimPanelExpandedHeight);
                            animation.Commit(PerushimPanel, "SnapExpandedPerushim", length: 200, easing: Easing.CubicOut);
                        }
                    }
                    else
                    {
                        var positionThreshold = _perushimPanelHeight * dismissThreshold;
                        var shouldDismiss = dragY > positionThreshold || velocity > velocityThreshold;

                        if (shouldDismiss)
                        {
                            await PerushimPanel.TranslateToAsync(0, _perushimPanelHeight, 200, Easing.CubicIn);
                            PerushimPanel.IsVisible = false;
                            _isPerushimOpen = false;
                            _isPerushimExpanded = false;
                            PerushimChevronButton.Text = Fonts.FluentUI.chevron_up_24_regular;
                        }
                        else
                        {
                            await PerushimPanel.TranslateToAsync(0, 0, 200, Easing.CubicOut);
                        }
                    }
                }
                else
                {
                    var expandThreshold = (_perushimPanelExpandedHeight - _perushimPanelHeight) * 0.3;
                    var heightIncrease = currentHeight - _perushimPanelHeight;
                    var shouldExpand = heightIncrease > expandThreshold || velocity > velocityThreshold;

                    if (shouldExpand && !_isPerushimExpanded)
                    {
                        _isPerushimExpanded = true;
                        var animation = new Animation(v => PerushimPanel.HeightRequest = v,
                            currentHeight, _perushimPanelExpandedHeight);
                        animation.Commit(PerushimPanel, "ExpandPerushim", length: 200, easing: Easing.CubicOut);
                    }
                    else if (!shouldExpand && _isPerushimExpanded)
                    {
                        var animation = new Animation(v => PerushimPanel.HeightRequest = v,
                            currentHeight, _perushimPanelExpandedHeight);
                        animation.Commit(PerushimPanel, "SnapExpandedPerushim", length: 200, easing: Easing.CubicOut);
                    }
                    else if (!shouldExpand)
                    {
                        var animation = new Animation(v => PerushimPanel.HeightRequest = v,
                            currentHeight, _perushimPanelHeight);
                        animation.Commit(PerushimPanel, "SnapPerushim", length: 200, easing: Easing.CubicOut);
                    }
                }
                break;

            default:
                // No pan state to update for unexpected gesture statuses.
                break;
        }
    }
}
