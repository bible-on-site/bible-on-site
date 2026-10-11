namespace BibleOnSite.Pages;

using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using Microsoft.Maui.Layouts;

/// <summary>
/// Reader page for מסורה על הפרק — Masoretic parasha units delimited by
/// ptuha/stuma breaks. Shares the על הפרק reader's interaction model
/// (carousel, perushim panel, articles, circular menu) while navigating
/// stable unit ids; rows are canonical pesukim clipped to each unit's
/// inclusive ranges — never a copied scripture corpus.
/// </summary>
public partial class MasoraPage : ContentPage, IQueryAttributable
{
    private readonly MasoraViewModel _viewModel;
    private bool _isLoading;

    // Circular menu state
    private bool _isMenuOpen;

    // Articles view state
    private bool _isShowingArticles;

    // Guard: ignore CurrentItemChanged events fired by the CarouselView during
    // initial collection assignment — the ViewModel already holds the unit.
    private bool _carouselInitializing;

    // Unit requested via query attributes before the initial load finished.
    private int? _pendingUnitId;

    // Perek requested via query attributes; resolved to its containing unit
    // only after the masora service loads.
    private int? _pendingPerekId;

    /// <summary>
    /// Proxy for article selection highlight binding (avoids XC0045 when binding from Article template).
    /// </summary>
    public int? SelectedArticleId => _viewModel.SelectedArticleId;

    public MasoraPage()
    {
        InitializeComponent();
        _viewModel = new MasoraViewModel();
        BindingContext = _viewModel;
        ForwardSelectedArticleIdChanged();
        SetupFontSizeResources();
        SetupCarouselNavigation();
        SetupCircularMenuLayout();
    }

    public MasoraPage(MasoraViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = _viewModel;
        ForwardSelectedArticleIdChanged();
        SetupFontSizeResources();
        SetupCarouselNavigation();
        SetupCircularMenuLayout();
    }

    /// <summary>
    /// Query attributes for deep navigation: <c>?unit=42</c> opens a unit by its
    /// stable id; <c>?perekId=5</c> opens the unit containing that perek's first
    /// pasuk (e.g. jumping from the על הפרק reader).
    /// </summary>
    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (query.TryGetValue("unit", out var unitValue))
        {
            _pendingUnitId = ParsePositiveInt(unitValue);
        }
        else if (query.TryGetValue("perekId", out var perekValue))
        {
            _pendingPerekId = ParsePositiveInt(perekValue);
        }
    }

    private static int? ParsePositiveInt(object value) => value switch
    {
        int i when i > 0 => i,
        string s when int.TryParse(s, out var parsed) && parsed > 0 => parsed,
        _ => null
    };

    /// <summary>
    /// Subscribes to ViewModel.NavigationRequested so that programmatic
    /// navigation (prev/next/picker) jumps the CarouselView instantly via
    /// ScrollTo(animate:false) instead of animating through every
    /// intermediate position (which would cascade OnCarouselItemChanged).
    /// </summary>
    private void SetupCarouselNavigation()
    {
        _viewModel.NavigationRequested += (_, index) =>
        {
            // Guard: suppress OnCarouselItemChanged while we reposition
            _carouselInitializing = true;
            MasoraCarousel.ScrollTo(index, animate: false);
            // Do not push CarouselPosition back into the two-way Position
            // binding here — it queues a second (animated) scroll that can
            // overshoot the target and land on the following unit.
            _carouselInitializing = false;

            if (_isMenuOpen)
            {
                RefreshNavButtonVisuals();
            }

            _ = UpdateArticlesCountAsync();
            _ = _viewModel.PreloadAdjacentRowsAsync(_viewModel.UnitId);
            if (_isShowingArticles)
            {
                _ = ShowUnitArticlesAsync();
            }
        };
    }

    /// <summary>
    /// Populates page-level DynamicResource entries for perush font sizes and
    /// keeps them in sync when the user changes the font-factor preference.
    /// </summary>
    private void SetupFontSizeResources()
    {
        UpdateFontSizeResources(_viewModel.FontFactor);
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(MasoraViewModel.FontFactor))
            {
                MainThread.BeginInvokeOnMainThread(() =>
                    UpdateFontSizeResources(_viewModel.FontFactor));
            }
        };
    }

    private void UpdateFontSizeResources(double factor)
    {
        Resources["PasukFontSize"] = factor * 18;
        Resources["PasukNumFontSize"] = factor * 16;
        Resources["PerushNameFontSize"] = factor * 14;
        Resources["PerushContentFontSize"] = factor * 16;
    }

    private void ForwardSelectedArticleIdChanged()
    {
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(MasoraViewModel.SelectedArticleId))
            {
                OnPropertyChanged(nameof(SelectedArticleId));
            }
            // When the unit changes via prev/next, refresh articles and nav buttons
            if (e.PropertyName == nameof(MasoraViewModel.Unit) || e.PropertyName == "Unit")
            {
                MainThread.BeginInvokeOnMainThread(() =>
                {
                    _ = UpdateArticlesCountAsync();
                    if (_isShowingArticles)
                    {
                        _ = ShowUnitArticlesAsync();
                    }
                    // Force visual refresh of prev/next buttons (workaround for MAUI not updating disabled visual)
                    RefreshNavButtonVisuals();
                });
            }
        };
    }

    /// <summary>
    /// Forces the prev/next buttons to update their visual state.
    /// Workaround for MAUI bug where button disabled visual doesn't refresh in AbsoluteLayout.
    /// </summary>
    private void RefreshNavButtonVisuals()
    {
        // Only update if menu is open (buttons visible)
        if (!_isMenuOpen)
        {
            return;
        }

        var canPrev = _viewModel.CanGoToPreviousUnit;
        var canNext = _viewModel.CanGoToNextUnit;

        PrevUnitButton.IsEnabled = canPrev;
        PrevUnitButton.Opacity = canPrev ? 1.0 : 0.4;

        NextUnitButton.IsEnabled = canNext;
        NextUnitButton.Opacity = canNext ? 1.0 : 0.4;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        if (_viewModel.Unit == null && !_isLoading)
        {
            _isLoading = true;
            try
            {
                // Show loading overlay while the carousel initialises.
                CarouselLoadingOverlay.IsVisible = true;

                var unitId = _pendingUnitId;
                if (unitId == null && _pendingPerekId is int perekId)
                {
                    unitId = await _viewModel.GetUnitIdForPerekAsync(perekId);
                }
                _pendingUnitId = null;
                _pendingPerekId = null;

                unitId ??= await _viewModel.GetInitialUnitIdAsync();

                // Guard: ignore OnCarouselItemChanged during initial load.
                _carouselInitializing = true;
                await _viewModel.LoadByUnitIdAsync(unitId.Value);

                // CarouselView resets Position to 0 when ItemsSource changes.
                // Force it to the correct position without animation.
                var targetPos = UnitIndexOf(_viewModel.UnitId);
                if (targetPos >= 0)
                {
                    MasoraCarousel.ScrollTo(targetPos, animate: false);
                    _viewModel.CarouselPosition = targetPos;
                }

                _carouselInitializing = false;

                // Hide loading overlay — carousel is ready
                CarouselLoadingOverlay.IsVisible = false;

                // Update articles count badge
                await UpdateArticlesCountAsync();

                // Preload rows for adjacent units so the next swipe is instant
                _ = _viewModel.PreloadAdjacentRowsAsync(_viewModel.UnitId);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Failed to load masora unit: {ex.Message}");
                await DisplayAlertAsync("שגיאה", $"לא ניתן לטעון את יחידת המסורה: {ex.Message}", "אישור");
            }
            finally
            {
                _isLoading = false;
            }
        }
    }

    /// <summary>The unit's index inside the carousel collection (-1 when missing).</summary>
    private int UnitIndexOf(int unitId)
    {
        for (var i = 0; i < _viewModel.CarouselUnits.Count; i++)
        {
            if (_viewModel.CarouselUnits[i].UnitId == unitId)
            {
                return i;
            }
        }
        return -1;
    }

    /// <summary>
    /// Carousel swipe: lazy-load the incoming unit's clipped rows, then update
    /// state and kick off perushim/articles/preload in the background — never
    /// block the next swipe.
    /// </summary>
    private async void OnCarouselItemChanged(object? sender, CurrentItemChangedEventArgs e)
    {
        if (_carouselInitializing)
        {
            return;
        }

        if (e.CurrentItem is not MasoraUnit unit || unit.UnitId <= 0 || unit.UnitId == _viewModel.UnitId)
        {
            return;
        }

        // Lazy-load rows if not yet loaded
        if (unit.Rows.Count == 0)
        {
            await _viewModel.EnsureRowsLoadedAsync(unit);
        }

        // Synchronous state update — fast, no guard needed.
        _viewModel.Unit = unit;

        // Refresh nav button visuals if menu is open (synchronous)
        if (_isMenuOpen)
        {
            RefreshNavButtonVisuals();
        }

        // Fire async tasks in the background — never block the next swipe
        _ = UpdateArticlesCountAsync();
        _ = _viewModel.LoadPerushimAsync(unit);
        _ = _viewModel.PreloadAdjacentRowsAsync(unit.UnitId);
        if (_isShowingArticles)
        {
            _ = ShowUnitArticlesAsync();
        }
    }

    #region Circular Menu

    private void SetupCircularMenuLayout()
    {
        FloatingMenuContainer.SizeChanged += (_, _) => LayoutCircularMenu();
    }

    /// <summary>
    /// Positions the toggle and the three satellite buttons on the elliptical
    /// fan computed by <see cref="BibleOnSite.Helpers.FanMenuGeometry"/>.
    /// </summary>
    private void LayoutCircularMenu()
    {
        var width = FloatingMenuContainer.Width - FloatingMenuContainer.Padding.HorizontalThickness;
        var height = FloatingMenuContainer.Height - FloatingMenuContainer.Padding.VerticalThickness;
        if (width <= 0 || height <= 0)
        {
            return;
        }

        var satellites = new[] { PrevUnitButton, UnitPickerButton, NextUnitButton };
        var layout = Helpers.FanMenuGeometry.Compute(width, height, satellites.Length);
        ApplyMenuBounds(CircularMenuButton, layout.Toggle);
        for (var i = 0; i < satellites.Length && i < layout.Items.Count; i++)
        {
            ApplyMenuBounds(satellites[i], layout.Items[i]);
        }
    }

    private static void ApplyMenuBounds(View view, Rect bounds)
    {
        AbsoluteLayout.SetLayoutFlags(view, AbsoluteLayoutFlags.None);
        AbsoluteLayout.SetLayoutBounds(view, bounds);
    }

    /// <summary>Toggles the circular menu open/closed state with animation.</summary>
    private async void OnCircularMenuClicked(object? sender, EventArgs e)
    {
        _isMenuOpen = !_isMenuOpen;

        if (_isMenuOpen)
        {
            await OpenCircularMenuAsync();
        }
        else
        {
            await CloseCircularMenuAsync();
        }
    }

    /// <summary>Opens the circular menu with animated expansion.</summary>
    private async Task OpenCircularMenuAsync()
    {
        var buttons = new[] { PrevUnitButton, UnitPickerButton, NextUnitButton };

        // Set prev/next enabled state before animating
        PrevUnitButton.IsEnabled = _viewModel.CanGoToPreviousUnit;
        NextUnitButton.IsEnabled = _viewModel.CanGoToNextUnit;

        foreach (var button in buttons)
        {
            button.InputTransparent = false;
            button.Opacity = 0;
        }

        // Change FAB icon to X
        CircularMenuButton.Text = Fonts.FluentUI.dismiss_24_regular;
        CircularMenuButton.BackgroundColor = Colors.Red;

        var animations = new List<Task>
        {
            CircularMenuButton.RotateToAsync(180, 250, Easing.SpringOut)
        };

        foreach (var button in buttons)
        {
            var targetOpacity = button.IsEnabled ? 1.0 : 0.4;
            animations.Add(button.FadeToAsync(targetOpacity, 200));
        }

        await Task.WhenAll(animations);
    }

    /// <summary>Closes the circular menu with animated contraction.</summary>
    private async Task CloseCircularMenuAsync()
    {
        var buttons = new[] { PrevUnitButton, UnitPickerButton, NextUnitButton };

        CircularMenuButton.Text = Fonts.FluentUI.navigation_24_regular;
        CircularMenuButton.BackgroundColor = (Color)Microsoft.Maui.Controls.Application.Current!.Resources["Primary"];

        var animations = new List<Task>
        {
            CircularMenuButton.RotateToAsync(0, 200, Easing.SpringOut)
        };

        foreach (var button in buttons)
        {
            animations.Add(button.FadeToAsync(0, 150));
        }

        await Task.WhenAll(animations);

        foreach (var button in buttons)
        {
            button.InputTransparent = true;
        }
    }

    /// <summary>Handles tap on a satellite menu item — the menu closes.</summary>
    private async void OnMenuItemClicked(object? sender, EventArgs e)
    {
        // Command-based buttons already fired their command; just close.
        _isMenuOpen = false;
        await CloseCircularMenuAsync();
    }

    #endregion

    #region Navigation & Picker

    private void OnReaderMenuClicked(object? sender, EventArgs e) =>
        Shell.Current.FlyoutIsPresented = true;

    /// <summary>Title tap — opens the unit picker.</summary>
    private void OnUnitSourceClicked(object? sender, EventArgs e)
    {
        MasoraUnitPickerPopup.Show(_viewModel.UnitId);
    }

    private void OnUnitPickerClicked(object? sender, EventArgs e)
    {
        MasoraUnitPickerPopup.Show(_viewModel.UnitId);
    }

    /// <summary>Handles unit selection from the picker popup.</summary>
    private async void OnUnitPickerSelected(object? sender, int unitId)
    {
        if (unitId > 0 && unitId != _viewModel.UnitId)
        {
            await _viewModel.NavigateToUnitAsync(unitId);
        }
    }

    #endregion

    #region Articles

    /// <summary>Updates the articles count badge for the current unit.</summary>
    private async Task UpdateArticlesCountAsync()
    {
        try
        {
            var unit = _viewModel.Unit;
            if (unit == null)
            {
                ArticlesBadge.IsVisible = false;
                return;
            }
            await _viewModel.LoadArticlesAsync(unit);
            ArticlesBadge.IsVisible = _viewModel.ArticlesCount > 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error fetching articles count: {ex.Message}");
            ArticlesBadge.IsVisible = false;
        }
    }

    /// <summary>Handles articles button click - shows the unit's articles.</summary>
    private async void OnArticlesButtonClicked(object? sender, EventArgs e)
    {
        try
        {
            if (_isShowingArticles)
            {
                return;
            }

            _isShowingArticles = true;
            await ShowUnitArticlesAsync();

            MasoraCarousel.IsVisible = false;
            ArticlesCollection.IsVisible = true;

            ArticlesButton.TextColor = Microsoft.Maui.Controls.Application.Current?.RequestedTheme == AppTheme.Dark
                ? Color.FromArgb("#BB86FC")
                : Color.FromArgb("#512BD4");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[Articles] Error in OnArticlesButtonClicked: {ex}");
        }
    }

    /// <summary>Returns to the unit text view.</summary>
    private void ShowUnitView()
    {
        _isShowingArticles = false;
        _viewModel.SelectedArticleId = null;

        ArticlesCollection.IsVisible = false;
        MasoraCarousel.IsVisible = true;

        ArticlesButton.TextColor = Microsoft.Maui.Controls.Application.Current?.RequestedTheme == AppTheme.Dark
            ? Color.FromArgb("#9CA3AF")
            : Color.FromArgb("#6B7280");
    }

    /// <summary>Pushes the unit's loaded articles into the articles grid.</summary>
    private async Task ShowUnitArticlesAsync()
    {
        var unit = _viewModel.Unit;
        if (unit == null)
        {
            return;
        }
        await _viewModel.LoadArticlesAsync(unit);
        ArticlesCollection.ItemsSource = _viewModel.Articles;
    }

    /// <summary>Handles article selection - navigates to article detail.</summary>
    private async void OnArticleSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.FirstOrDefault() is Article article)
        {
            _viewModel.SelectedArticleId = article.Id;
            ArticlesCollection.SelectedItem = null;

            try
            {
                await Shell.Current.GoToAsync($"articleDetail?articleId={article.Id}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error navigating to article: {ex.Message}");
            }
        }
    }

    #endregion

    #region Perushim Panel

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
        }
        finally
        {
            _isTogglingPerush = false;
        }
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
        _perushimPanelExpandedHeight = totalHeight - 50; // Full screen minus top margin

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
        }
    }

    #endregion

    #region Full Screen

    /// <summary>Text button — returns to the unit view from articles, else scrolls to top.</summary>
    private void OnTextButtonClicked(object? sender, EventArgs e)
    {
        if (_isShowingArticles)
        {
            ShowUnitView();
        }
        else
        {
            MasoraCarousel.ScrollTo(_viewModel.CarouselPosition, position: ScrollToPosition.Start, animate: false);
        }
    }

    /// <summary>Enters full screen mode - hides top and bottom bars, shows exit button.</summary>
    private void OnFullScreenClicked(object? sender, EventArgs e)
    {
        // Close circular menu if open
        if (_isMenuOpen)
        {
            _isMenuOpen = false;
            var buttons = new[] { PrevUnitButton, UnitPickerButton, NextUnitButton };
            foreach (var b in buttons)
            {
                b.Opacity = 0;
                b.InputTransparent = true;
            }
            CircularMenuButton.Text = Fonts.FluentUI.navigation_24_regular;
            CircularMenuButton.BackgroundColor = (Color)Microsoft.Maui.Controls.Application.Current!.Resources["Primary"];
            CircularMenuButton.Rotation = 0;
        }

        ReaderToolbar.IsVisible = false;
        BottomBar.IsVisible = false;
        FloatingMenuContainer.IsVisible = false;
        ExitFullScreenButton.IsVisible = true;
    }

    /// <summary>Exits full screen mode - restores navigation and bottom bar.</summary>
    private void OnExitFullScreenClicked(object? sender, TappedEventArgs e)
    {
        ExitFullScreenButton.IsVisible = false;
        ReaderToolbar.IsVisible = true;
        BottomBar.IsVisible = true;
        FloatingMenuContainer.IsVisible = true;
    }

    #endregion
}
