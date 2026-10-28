using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// לוח לימוד יומי — a Hebrew RTL month calendar over the 929 schedule.
/// </summary>
public partial class LearningCalendarPage : ContentPage
{
    private readonly LearningCalendarViewModel _viewModel;
    private bool _initialized;

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
        // Month/cycle state lives in the view-model; returning from the
        // reader (Back) restores the same viewed month without reloading.
        if (_initialized)
        {
            return;
        }

        _initialized = true;
        await _viewModel.InitializeAsync();
    }

    private void OnCellTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is CalendarCellViewModel cell)
        {
            _ = _viewModel.OpenPerekCommand.ExecuteAsync(cell);
        }
    }
}
