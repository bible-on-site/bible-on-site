using CommunityToolkit.Maui;
using CommunityToolkit.Maui.Extensions;
using CommunityToolkit.Maui.Views;

namespace BibleOnSite.Controls;

/// <summary>
/// The single-Back exit confirmation as an app-owned popup so the action text
/// colors follow the design request: המשך ללמוד in the theme blue, צא מהישומון
/// in red — text colors, not colored button backgrounds. Tapping outside or
/// dismissing the popup resolves to "stay" (#2460).
/// </summary>
public partial class ExitConfirmationPopup : Popup<bool> //NOSONAR partial is required by XAML codegen
{
	public ExitConfirmationPopup()
	{
		InitializeComponent();
	}

	private async void OnStayClicked(object? sender, EventArgs e) => await CloseAsync(false);

	private async void OnExitClicked(object? sender, EventArgs e) => await CloseAsync(true);

	/// <summary>Shows the prompt over the current Shell page; resolves to true
	/// only when the user taps the exit action.</summary>
	public static async Task<bool> ShowAsync()
	{
		var shell = Shell.Current;
		if (shell?.CurrentPage is null)
		{
			return false;
		}
		var result = await shell.ShowPopupAsync<bool>(
			new ExitConfirmationPopup(),
			new PopupOptions { CanBeDismissedByTappingOutsideOfPopup = true },
			CancellationToken.None);
		return result is { WasDismissedByTappingOutsideOfPopup: false, Result: true };
	}
}
