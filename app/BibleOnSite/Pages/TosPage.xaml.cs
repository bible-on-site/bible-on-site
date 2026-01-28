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
}
