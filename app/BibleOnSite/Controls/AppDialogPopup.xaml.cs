using CommunityToolkit.Maui;
using CommunityToolkit.Maui.Extensions;
using CommunityToolkit.Maui.Views;
using BibleOnSite.Services;

namespace BibleOnSite.Controls;

/// <summary>
/// The app-owned presenter for every blocking dialog (#2630). Renders an
/// <see cref="AppDialogRequest"/> on the shared surface: uniform title/body/
/// action typography, role colors (theme-blue safe actions, red destructive —
/// text color, never colored backgrounds, #2460), RTL-mirrored action order,
/// adaptive width, and a bounded, scrollable message so the actions are always
/// visible. Tapping outside, system Back or any other dismissal resolves to
/// null — the documented safe-dismiss ("stay"/keep-state) outcome.
/// </summary>
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration.
public partial class AppDialogPopup : Popup<AppDialogAction>
#pragma warning restore S2333
{
	private bool _completed;

	public AppDialogPopup(AppDialogRequest request)
	{
		InitializeComponent();
		Card.AutomationId = $"{request.AutomationIdPrefix}Card";
		TitleLabel.AutomationId = $"{request.AutomationIdPrefix}Title";
		TitleLabel.Text = request.Title;
		MessageLabel.AutomationId = $"{request.AutomationIdPrefix}Message";
		MessageLabel.Text = request.Message;
		BuildActions(request);
	}

	private void BuildActions(AppDialogRequest request)
	{
		var ordered = request.OrderedActions;
		ActionsGrid.ColumnDefinitions = new ColumnDefinitionCollection(
			ordered.Select(_ => new ColumnDefinition(GridLength.Star)).ToArray());
		for (var column = 0; column < ordered.Count; column++)
		{
			var action = ordered[column];
			var button = new Button
			{
				Text = action.Text,
				AutomationId = request.AutomationIdFor(action),
				Style = (Style)Resources[AppDialogPolicy.StyleKeyFor(action.Role)],
			};
			SemanticProperties.SetDescription(button, action.Text);
			var tapped = action;
			button.Clicked += async (_, _) => await ResolveAsync(tapped);
			ActionsGrid.Add(button, column, 0);
		}
	}

	/// <summary>Resolves once — rapid double taps cannot double-submit an action.</summary>
	private async Task ResolveAsync(AppDialogAction action)
	{
		if (_completed)
		{
			return;
		}

		_completed = true;
		await CloseAsync(action);
	}

	/// <summary>
	/// Shows the request over the current Shell page; resolves to the tapped
	/// action, or null on outside-tap/Back dismissal and when no page can host
	/// the popup.
	/// </summary>
	public static async Task<AppDialogAction?> ShowAsync(AppDialogRequest request)
	{
		var shell = Shell.Current;
		var page = shell?.CurrentPage;
		if (page is null)
		{
			return null;
		}

		var popup = new AppDialogPopup(request);
		var width = AppDialogStyle.WidthFor(page.Width);
		if (width > 0)
		{
			popup.WidthRequest = width;
		}

		var messageHeight = AppDialogStyle.MaxMessageHeightFor(page.Height);
		if (messageHeight > 0)
		{
			popup.MessageScroll.MaximumHeightRequest = messageHeight;
		}

		var result = await shell!.ShowPopupAsync<AppDialogAction>(
			popup,
			new PopupOptions
			{
				CanBeDismissedByTappingOutsideOfPopup = true,
				PageOverlayColor = AppDialogStyle.ScrimColor,
			},
			CancellationToken.None);
		return result is { WasDismissedByTappingOutsideOfPopup: false } ? result.Result : null;
	}
}
