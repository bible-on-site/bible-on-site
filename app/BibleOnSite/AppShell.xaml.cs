using BibleOnSite.Config;
using BibleOnSite.Pages;

namespace BibleOnSite;

public partial class AppShell : Shell
{
	public AppShell()
	{
		InitializeComponent();

		// Register routes for pages that are navigated to with parameters
		Routing.RegisterRoute("ArticlesPage", typeof(ArticlesPage));
		Routing.RegisterRoute("AuthorsPage", typeof(AuthorsPage));
		Routing.RegisterRoute("articleDetail", typeof(ArticleDetailPage));
		Routing.RegisterRoute("LoadingPage", typeof(LoadingPage));
		Routing.RegisterRoute("ContactPage", typeof(ContactPage));
		Routing.RegisterRoute("DonationsPage", typeof(DonationsPage));
		Routing.RegisterRoute("TosPage", typeof(TosPage));
	}

	private async void OnAlHaperekTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToAsync("//PerekPage");
	}

	private async void OnAuthorsTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToAsync("//AuthorsPage");
	}

	private async void OnTermsTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToAsync("//TosPage");
	}

	private async void OnPreferencesTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await DisplayAlert("העדפות", "מסך ההעדפות יתווסף בקרוב.", "אישור");
	}

	private async void OnContactTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToAsync("//ContactPage");
	}

	private async void OnDonationsTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToAsync("//DonationsPage");
	}
}
