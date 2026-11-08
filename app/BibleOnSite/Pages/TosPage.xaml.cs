using BibleOnSite.Services;

namespace BibleOnSite.Pages;

public partial class TosPage : ContentPage
{
    public TosPage()
    {
        InitializeComponent();
    }

    private async void OnSefariaTapped(object? sender, TappedEventArgs e)
    {
        await Launcher.OpenAsync(new Uri("https://sefaria.org"));
    }

    private async void OnDanBarryTapped(object? sender, TappedEventArgs e)
    {
        await Launcher.OpenAsync(new Uri("https://he.wikipedia.org/wiki/%D7%93%D7%9F_%D7%91%D7%90%D7%A8%D7%99"));
    }

    private async void OnAccessibilityStatementTapped(object? sender, TappedEventArgs e)
    {
        await AccessibilityStatement.OpenAsync(Launcher.Default, ShellAppNavigator.Instance);
    }

    private async void OnPrivacyPolicyTapped(object? sender, TappedEventArgs e)
    {
        try
        {
            await Launcher.OpenAsync(new Uri($"{Config.AppConfig.Instance.WebsiteUrl}/#privacyPolicy"));
        }
        catch (Exception ex) //NOSONAR - launcher failures are platform-specific; the user gets an alert.
        {
            System.Diagnostics.Debug.WriteLine($"Open privacy policy failed: {ex.Message}");
            await ShellAppNavigator.Instance.DisplayAlertAsync("שגיאה", "לא ניתן לפתוח את מדיניות הפרטיות", "אישור");
        }
    }
}
