namespace BibleOnSite;

public partial class App : Application
{
	public App()
	{
		try
		{
			InitializeComponent();
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"InitializeComponent failed: {ex}");
			Console.Error.WriteLine($"InitializeComponent failed: {ex}");
			throw;
		}
	}

	protected override Window CreateWindow(IActivationState? activationState)
	{
		try
		{
			var window = new Window(new AppShell());
			window.Stopped += (_, _) => Services.RecitationService.Instance.RequestPlaybackStop();
			return window;
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"CreateWindow failed: {ex}");
			Console.Error.WriteLine($"CreateWindow failed: {ex}");
			throw;
		}
	}
}
