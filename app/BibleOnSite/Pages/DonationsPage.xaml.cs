using BibleOnSite.Services;

namespace BibleOnSite.Pages;

public partial class DonationsPage : ContentPage
{
    public DonationsPage()
    {
        InitializeComponent();
    }

    private async void OnContactTapped(object? sender, TappedEventArgs e)
    {
        try
        {
            await ShellAppNavigator.Instance.GoToAsync("ContactPage");
        }
        #pragma warning disable S2221 // Deliberate failure boundary: navigation failure is log-only
        catch (Exception ex) //NOSONAR — navigation failure is log-only.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Navigation to ContactPage failed: {ex}");
        }
    }
}
