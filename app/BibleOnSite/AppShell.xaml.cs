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
	}

	private async void OnTermsClicked(object? sender, EventArgs e)
	{
		FlyoutIsPresented = false;
		await DisplayAlert("תנאי שימוש", "תנאי השימוש והצהרת הפרטיות יתווספו בקרוב.", "אישור");
	}

	private async void OnPreferencesClicked(object? sender, EventArgs e)
	{
		FlyoutIsPresented = false;
		await DisplayAlert("העדפות", "מסך ההעדפות יתווסף בקרוב.", "אישור");
	}

	private async void OnContactClicked(object? sender, EventArgs e)
	{
		FlyoutIsPresented = false;
		await DisplayAlert("צור קשר", "ניתן ליצור קשר עם צוות התכנית דרך האתר.", "אישור");
	}

	private async void OnDonationsClicked(object? sender, EventArgs e)
	{
		FlyoutIsPresented = false;
		await DisplayAlert("תרומות", "תודה על תמיכתכם! אפשרות תרומה תתווסף בקרוב.", "אישור");
	}
}
