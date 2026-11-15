using BibleOnSite.Config;

namespace BibleOnSite.Pages;

public partial class TosPage : ContentPage
{
    public TosPage()
    {
        InitializeComponent();
    }

    private async void OnFontLicenseTapped(object? sender, TappedEventArgs e)
    {
        var licenseUri = new Uri(new Uri(AppConfig.Instance.TosUrl), "/font-license.txt");
        await Launcher.OpenAsync(licenseUri);
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
