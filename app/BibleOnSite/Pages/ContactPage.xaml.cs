namespace BibleOnSite.Pages;

public partial class ContactPage : ContentPage
{
    public ContactPage()
    {
        InitializeComponent();
    }

    private async void OnWhatsAppTapped(object? sender, TappedEventArgs e)
    {
        try
        {
            await Launcher.OpenAsync(new Uri("https://wa.me/37257078640"));
        }
        #pragma warning disable S2221 // Deliberate failure boundary: external launcher failure is log-only
        catch (Exception ex) //NOSONAR — external launcher failure is log-only.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Error opening WhatsApp: {ex.Message}");
        }
    }

    private async void OnTelegramTapped(object? sender, TappedEventArgs e)
    {
        try
        {
            await Launcher.OpenAsync(new Uri("https://t.me/BibleOnSite"));
        }
        #pragma warning disable S2221 // Deliberate failure boundary: external launcher failure is log-only
        catch (Exception ex) //NOSONAR — external launcher failure is log-only.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Error opening Telegram: {ex.Message}");
        }
    }

    private async void OnEmailTapped(object? sender, TappedEventArgs e)
    {
        try
        {
            var emailUri = new Uri("mailto:tanah.site@gmail.com?subject=" + Uri.EscapeDataString("פניה מלומד"));
            await Launcher.OpenAsync(emailUri);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: external launcher failure is log-only
        catch (Exception ex) //NOSONAR — external launcher failure is log-only.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Error opening email: {ex.Message}");
        }
    }
}
