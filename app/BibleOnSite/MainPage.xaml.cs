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
		await Shell.Current.GoToAsync("//PerekPage");
	}

	private async void OnCounterClicked(object sender, EventArgs e)
	{
		count++;

		if (count == 1)
			CounterBtn.Text = $"Clicked {count} time";
		else
			CounterBtn.Text = $"Clicked {count} times";

		SemanticScreenReader.Announce(CounterBtn.Text);

		await LoadStarterDataAsync();
	}


	private async Task LoadStarterDataAsync()
	{
		try
		{
			await StarterService.Instance.LoadAsync();
			var authorsCount = StarterService.Instance.Authors.Count;
			Console.WriteLine($"Loaded {authorsCount} authors");
		}
		catch (Exception ex)
		{
			Console.Error.WriteLine($"Failed to load starter data: {ex.Message}");
		}
	}
}

