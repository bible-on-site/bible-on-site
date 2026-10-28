using BibleOnSite.Helpers;
using BibleOnSite.Services;

namespace BibleOnSite;

public partial class MainPage : ContentPage
{
	int count = 0;

	public MainPage()
	{
		InitializeComponent();
	}

	private async void OnGoToPerekClicked(object sender, EventArgs e)
	{
		await ShellAppNavigator.Instance.GoToAsync("//PerekPage");
	}

	private async void OnCounterClicked(object sender, EventArgs e)
	{
		count++;

		CounterBtn.Text = count == 1 ? $"Clicked {count} time" : $"Clicked {count} times";

		SemanticScreenReader.Announce(CounterBtn.Text);

		await LoadStarterDataAsync();
	}


	private async Task LoadStarterDataAsync()
	{
		try
		{
			await StarterService.Instance.LoadAsync();
		}
		#pragma warning disable S2221 // Deliberate failure boundary: starter-data load failure proceeds offline
		catch (Exception ex) //NOSONAR — starter-data load failure proceeds offline.
		{
		    #pragma warning restore S2221
			Console.Error.WriteLine($"Failed to load starter data: {ex}");
			return;
		}
		var authorsCount = StarterService.Instance.Authors.Count;
		DebugLog.Write($"Loaded {authorsCount} authors");
	}
}

