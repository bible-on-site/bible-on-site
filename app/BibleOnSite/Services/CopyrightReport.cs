using Microsoft.Maui.ApplicationModel;

namespace BibleOnSite.Services;

public static class CopyrightReport
{
    public static async Task OpenEmailAsync(ILauncher launcher, IAppNavigator navigator)
    {
        try
        {
            if (await launcher.OpenAsync(new Uri("mailto:tanah.site@gmail.com")))
            {
                return;
            }

            Console.Error.WriteLine("Opening copyright reporting email returned false.");
        }
        catch (Exception ex) when (ex is FeatureNotSupportedException
            or InvalidOperationException or UriFormatException or ArgumentException)
        {
            Console.Error.WriteLine($"Error opening copyright reporting email: {ex.Message}");
        }

        await navigator.DisplayAlertAsync("שגיאה",
            "לא ניתן לפתוח את אפליקציית הדואר. ניתן לשלוח דיווח לכתובת tanah.site@gmail.com", "אישור");
    }
}
