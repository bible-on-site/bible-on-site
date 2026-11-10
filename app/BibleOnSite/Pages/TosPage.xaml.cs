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

    private async void OnCopyrightEmailTapped(object? sender, TappedEventArgs e)
    {
        try
        {
            await Launcher.OpenAsync(new Uri("mailto:tanah.site@gmail.com"));
        }
        catch (Exception ex) when (ex is FeatureNotSupportedException
            or InvalidOperationException or UriFormatException or ArgumentException)
        {
            Console.Error.WriteLine($"Error opening email: {ex.Message}");
            await ShellAppNavigator.Instance.DisplayAlertAsync("שגיאה", "לא ניתן לפתוח את אפליקציית הדואר. נסו שוב", "אישור");
        }
    }

    private async void OnPrivacyPolicyTapped(object? sender, TappedEventArgs e)
    {
        try
        {
            await Launcher.OpenAsync(new Uri($"{Config.AppConfig.Instance.WebsiteUrl}/#privacyPolicy"));
        }
        catch (Exception ex) when (ex is FeatureNotSupportedException
            or InvalidOperationException or UriFormatException or ArgumentException)
        {
            System.Diagnostics.Debug.WriteLine($"Open privacy policy failed: {ex.Message}");
            await ShellAppNavigator.Instance.DisplayAlertAsync("שגיאה", "לא ניתן לפתוח את מדיניות הפרטיות", "אישור");
        }
    }
}
