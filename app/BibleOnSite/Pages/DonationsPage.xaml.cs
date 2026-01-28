namespace BibleOnSite.Pages;

public partial class DonationsPage : ContentPage
{
    public DonationsPage()
    {
        InitializeComponent();
    }

    private async void OnContactTapped(object? sender, TappedEventArgs e)
    {
        await Shell.Current.GoToAsync("//ContactPage");
    }
}
