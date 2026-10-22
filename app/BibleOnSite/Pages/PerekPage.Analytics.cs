using BibleOnSite.Services;

namespace BibleOnSite.Pages;

#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class PerekPage
#pragma warning restore S2333
{
    private bool _analyticsNoticeShown;

    private void ShowAnalyticsNotice()
    {
#if (ANDROID || IOS) && !DISABLE_ANALYTICS
        AnalyticsNotice.IsVisible = !SearchIndexService.IsE2eMarkedProcess()
            && !PreferencesService.Instance.AnalyticsConsentAsked;
#endif
    }

    private void OnAnalyticsNoticeSizeChanged(object? sender, EventArgs e)
    {
        // Merely opening the reader or laying it out never starts collection.
        // Wait until the notice has actually occupied space on screen.
        _analyticsNoticeShown = AnalyticsNotice.IsVisible
            && AnalyticsNotice.Width > 0 && AnalyticsNotice.Height > 0;
    }

    private void RecordReaderContinuedUse()
    {
        if (!_analyticsNoticeShown || !AnalyticsNotice.IsVisible || !ReaderToolbar.IsVisible)
        {
            return;
        }

        PreferencesService.Instance.RecordAnalyticsContinuedUse(noticeShown: true);
        if (_viewModel.PerekId > 0)
        {
            // Startup tracking was off; report the chapter once informed use
            // enables measurement. The analytics service still honors opt-out.
            SetAnalyticsScreenForPerek();
        }
        AnalyticsNotice.IsVisible = false;
        _analyticsNoticeShown = false;
    }

    private void OnAnalyticsOptOutClicked(object? sender, EventArgs e)
    {
        PreferencesService.Instance.SetAnalyticsConsent(false);
        AnalyticsNotice.IsVisible = false;
        _analyticsNoticeShown = false;
    }

    private void OnAnalyticsDismissClicked(object? sender, EventArgs e)
    {
        RecordReaderContinuedUse();
    }

    private async void OnAnalyticsPrivacyClicked(object? sender, EventArgs e)
    {
        // Reading the policy is not continued use of the reader.
        await Shell.Current.GoToAsync("TosPage");
    }
}
