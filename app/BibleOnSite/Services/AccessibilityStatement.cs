using BibleOnSite.Config;
using Microsoft.Maui.ApplicationModel;

namespace BibleOnSite.Services;

/// <summary>
/// Opens the accessibility statement maintained on the website (#2396) so the app
/// never carries a second copy that can drift.
/// </summary>
public static class AccessibilityStatement
{
    public static async Task OpenAsync(ILauncher launcher, IAppNavigator navigator)
    {
        try
        {
            await launcher.OpenAsync(new Uri(AppConfig.Instance.AccessibilityUrl));
        }
        catch (Exception ex) //NOSONAR — launcher failures are platform-specific; the user gets an alert.
        {
            System.Diagnostics.Debug.WriteLine($"Open accessibility statement failed: {ex.Message}");
            await navigator.DisplayAlertAsync("שגיאה", "לא ניתן לפתוח את הצהרת הנגישות", "אישור");
        }
    }
}
