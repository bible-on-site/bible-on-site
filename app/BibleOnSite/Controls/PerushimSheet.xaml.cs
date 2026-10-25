using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Controls;

/// <summary>
/// The reader's perushim bottom sheet shared by the perek, parasha and masora
/// readers: the slide-up commentary panel, its pan-to-dismiss/expand gesture,
/// the RTL search that scrolls to the first match, and the checkbox toggle
/// pipeline. The host view model implements <see cref="IPerushimSheetViewModel"/>
/// for checked-state and the filtered list; everything else binds through the
/// ambient BindingContext (Perushim, CheckedPerushim, PerushimSelectionStatus…).
/// </summary>
#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class PerushimSheet : Border
#pragma warning restore S2333
{
    private bool _isExpanded;
    private double _panelHeight;
    private double _expandedHeight;
    private double _panStartHeight;
    private double _lastPanY;
    private DateTime _lastPanTime;

    private bool _isTogglingPerush;

    /// <summary>Whether the sheet is currently open.</summary>
    public bool IsOpen { get; private set; }

    /// <summary>Raised whenever <see cref="IsOpen"/> changes (toggle, pan-dismiss).</summary>
#pragma warning disable S3264 // Subscribed by the reader pages' code-behind; Codacy's per-file analysis misses them.
    public event EventHandler<bool>? IsOpenChanged;
#pragma warning restore S3264

    private IPerushimSheetViewModel? ViewModel => BindingContext as IPerushimSheetViewModel;

    public PerushimSheet()
    {
        InitializeComponent();
    }

    /// <summary>
    /// Toggles the sheet open/closed with a slide animation.
    /// </summary>
    /// <param name="hostHeight">Height of the host reader area (MainGrid).</param>
    /// <param name="maxExpandedHeight">
    /// Cap for drag-up expansion — the content area plus the toolbar height
    /// minus a small margin, so the sheet's top edge stays under the status bar.
    /// </param>
    public async Task ToggleAsync(double hostHeight, double maxExpandedHeight)
    {
        SetOpen(!IsOpen);
        _isExpanded = false;

        _panelHeight = (hostHeight * 0.33) + 90; // Default: 33% + bottom bar
        _expandedHeight = Math.Max(_panelHeight, maxExpandedHeight);

        if (IsOpen)
        {
            HeightRequest = _panelHeight;
            TranslationY = _panelHeight;
            IsVisible = true;

            await this.TranslateToAsync(0, 0, 250, Easing.CubicOut);
        }
        else
        {
            SearchBar.Unfocus();
            await this.TranslateToAsync(0, _panelHeight, 250, Easing.CubicIn);
            IsVisible = false;
        }
    }

    /// <summary>Closes the sheet without animation (e.g. entering fullscreen).</summary>
    public void CloseImmediate()
    {
        if (!IsOpen)
        {
            return;
        }
        SetOpen(false);
        _isExpanded = false;
        IsVisible = false;
        TranslationY = 0;
    }

    private void SetOpen(bool value)
    {
        if (IsOpen == value)
        {
            return;
        }
        IsOpen = value;
        IsOpenChanged?.Invoke(this, value);
    }

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
        var viewModel = ViewModel;
        if (perush == null || viewModel == null)
        {
            return;
        }

        bool wantChecked = e.Value;
        bool alreadyChecked = viewModel.IsPerushChecked(perush.Id);
        if (wantChecked == alreadyChecked)
        {
            return;
        }

        SearchBar.Unfocus();
        _isTogglingPerush = true;
        try
        {
            viewModel.ToggleCheckedPerush(perush.Id);
            checkBox.IsChecked = viewModel.IsPerushChecked(perush.Id);
        }
        finally
        {
            _isTogglingPerush = false;
        }
    }

    /// <summary>
    /// Perushim search navigates instead of filtering — the full list stays
    /// visible and each keystroke scrolls the first matching perush into view.
    /// Subscribed to the view model's property change (which fires after
    /// PerushNameFilter is assigned), not the entry's TextChanged.
    /// </summary>
    protected override void OnBindingContextChanged()
    {
        base.OnBindingContextChanged();
        if (_subscribedVm is System.ComponentModel.INotifyPropertyChanged old)
        {
            old.PropertyChanged -= OnViewModelPropertyChanged;
        }
        _subscribedVm = BindingContext;
        if (_subscribedVm is System.ComponentModel.INotifyPropertyChanged inpc)
        {
            inpc.PropertyChanged += OnViewModelPropertyChanged;
        }
    }

    private object? _subscribedVm;

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName != "PerushNameFilter" || !IsOpen)
        {
            return;
        }
        var match = ViewModel?.FilteredPerushim.FirstOrDefault();
        if (match != null)
        {
            PerushimCollection.ScrollTo(match, position: ScrollToPosition.Start, animate: false);
        }
    }

    private void OnSearchSubmitted(object? sender, EventArgs e) => _ = HideKeyboardAsync();

    /// <summary>Dismisses the soft keyboard — iOS leaves it over the list otherwise.</summary>
    private async Task HideKeyboardAsync()
    {
        try
        {
            // Unfocus alone can leave the floating keyboard over the list.
            await SearchBar.HideSoftInputAsync(CancellationToken.None);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: see the //NOSONAR note
        catch (Exception ex) //NOSONAR — failure boundary: keyboard dismissal is best-effort and must not crash the reader.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Could not dismiss perushim search keyboard: {ex}");
        }
        SearchBar.Unfocus();
    }

    private async void OnGoToPerushimSettingsClicked(object? sender, EventArgs e)
    {
        try
        {
            await PreferencesNavigation.OpenPerushimDownloadAsync(ShellAppNavigator.Instance);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: settings navigation failure is log-only
        catch (Exception ex) //NOSONAR — settings navigation failure is log-only.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Navigate to perushim settings failed: {ex}");
        }
    }

    /// <summary>
    /// Pan gesture on the sheet header: drag down dismisses at the default size
    /// (or collapses first when expanded), drag up expands toward full height.
    /// Velocity-based, so a fast flick completes the motion.
    /// </summary>
    private async void OnPanelPan(object? sender, PanUpdatedEventArgs e)
    {
        if (!IsOpen)
        {
            return;
        }

        const double dismissThreshold = 0.3;
        const double velocityThreshold = 800;

        switch (e.StatusType)
        {
            case GestureStatus.Started:
                _panStartHeight = HeightRequest;
                _lastPanY = 0;
                _lastPanTime = DateTime.Now;
                this.CancelAnimations();
                break;

            case GestureStatus.Running:
                _lastPanY = e.TotalY;
                _lastPanTime = DateTime.Now;

                if (e.TotalY > 0)
                {
                    if (_isExpanded)
                    {
                        var newHeight = Math.Max(_panelHeight,
                            _panStartHeight - e.TotalY);
                        HeightRequest = newHeight;
                    }
                    else
                    {
                        TranslationY = e.TotalY;
                    }
                }
                else
                {
                    var newHeight = Math.Min(_expandedHeight,
                        _panStartHeight - e.TotalY);
                    HeightRequest = newHeight;
                }
                break;

            case GestureStatus.Completed:
            case GestureStatus.Canceled:
                var elapsedMs = (DateTime.Now - _lastPanTime).TotalMilliseconds;
                var velocity = elapsedMs > 0 ? Math.Abs(_lastPanY) / (elapsedMs / 1000.0) : 0;

                var dragY = TranslationY;
                var currentHeight = HeightRequest;

                if (_lastPanY > 0)
                {
                    if (_isExpanded)
                    {
                        var collapseThreshold = (_expandedHeight - _panelHeight) * dismissThreshold;
                        var heightDecrease = _panStartHeight - currentHeight;
                        var shouldCollapse = heightDecrease > collapseThreshold || velocity > velocityThreshold;

                        if (shouldCollapse)
                        {
                            _isExpanded = false;
                            var animation = new Animation(v => HeightRequest = v,
                                currentHeight, _panelHeight);
                            animation.Commit(this, "CollapsePerushim", length: 200, easing: Easing.CubicOut);
                        }
                        else
                        {
                            var animation = new Animation(v => HeightRequest = v,
                                currentHeight, _expandedHeight);
                            animation.Commit(this, "SnapExpandedPerushim", length: 200, easing: Easing.CubicOut);
                        }
                    }
                    else
                    {
                        var positionThreshold = _panelHeight * dismissThreshold;
                        var shouldDismiss = dragY > positionThreshold || velocity > velocityThreshold;

                        if (shouldDismiss)
                        {
                            SearchBar.Unfocus();
                            await this.TranslateToAsync(0, _panelHeight, 200, Easing.CubicIn);
                            IsVisible = false;
                            _isExpanded = false;
                            SetOpen(false);
                        }
                        else
                        {
                            await this.TranslateToAsync(0, 0, 200, Easing.CubicOut);
                        }
                    }
                }
                else
                {
                    var expandThreshold = (_expandedHeight - _panelHeight) * 0.3;
                    var heightIncrease = currentHeight - _panelHeight;
                    var shouldExpand = heightIncrease > expandThreshold || velocity > velocityThreshold;

                    if (shouldExpand && !_isExpanded)
                    {
                        _isExpanded = true;
                        var animation = new Animation(v => HeightRequest = v,
                            currentHeight, _expandedHeight);
                        animation.Commit(this, "ExpandPerushim", length: 200, easing: Easing.CubicOut);
                    }
                    else if (!shouldExpand && _isExpanded)
                    {
                        var animation = new Animation(v => HeightRequest = v,
                            currentHeight, _expandedHeight);
                        animation.Commit(this, "SnapExpandedPerushim", length: 200, easing: Easing.CubicOut);
                    }
                    else if (!shouldExpand)
                    {
                        var animation = new Animation(v => HeightRequest = v,
                            currentHeight, _panelHeight);
                        animation.Commit(this, "SnapPerushim", length: 200, easing: Easing.CubicOut);
                    }
                }
                break;

            default:
                // No pan state to update for unexpected gesture statuses.
                break;
        }
    }
}
