using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// לוח לימוד יומי — a Hebrew RTL month calendar over the 929 schedule.
/// </summary>
public partial class LearningCalendarPage : ContentPage
{
    private readonly LearningCalendarViewModel _viewModel;
    private bool _initialized;
    private IDispatcherTimer? _dateRefreshTimer;
    private Window? _dateRefreshWindow;

    public LearningCalendarPage()
        : this(new LearningCalendarViewModel())
    {
    }

    internal LearningCalendarPage(LearningCalendarViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = viewModel;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (_dateRefreshTimer is null)
        {
            _dateRefreshTimer = Dispatcher.CreateTimer();
            _dateRefreshTimer.Interval = TimeSpan.FromMinutes(1);
            _dateRefreshTimer.Tick += OnDateRefresh;
        }
        _dateRefreshTimer.Start();
        if (_dateRefreshWindow is null && Window is { } window)
        {
            _dateRefreshWindow = window;
            window.Resumed += OnDateRefresh;
        }
        // Month/cycle state lives in the view-model; returning from the
        // reader (Back) restores the same viewed month without reloading.
        if (_initialized)
        {
            _viewModel.RefreshToday();
            return;
        }

        _initialized = true;
        await _viewModel.InitializeAsync();
    }

    protected override void OnDisappearing()
    {
        _dateRefreshTimer?.Stop();
        if (_dateRefreshWindow is { } window)
        {
            window.Resumed -= OnDateRefresh;
            _dateRefreshWindow = null;
        }
        base.OnDisappearing();
    }

    private void OnDateRefresh(object? sender, EventArgs e) => _viewModel.RefreshToday();

    private void OnCellTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is CalendarCellViewModel cell)
        {
            _ = _viewModel.OpenPerekCommand.ExecuteAsync(cell);
        }
    }
}
