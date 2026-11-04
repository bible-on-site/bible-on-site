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

	/// <summary>
	/// Open dialogs, topmost last (#2766). The shared Windows input layer
	/// consults it so Back/Esc peel the modal surface instead of reaching the
	/// page underneath. Weak references: a dialog leaked by a crashed close
	/// path can never trap the registry or stay a ghost dismissal target.
	/// </summary>
	private static readonly List<WeakReference<AppDialogPopup>> _openDialogs = [];

	public AppDialogPopup(AppDialogRequest request)
	{
		InitializeComponent();
		Card.AutomationId = $"{request.AutomationIdPrefix}Card";
		TitleLabel.AutomationId = $"{request.AutomationIdPrefix}Title";
		TitleLabel.Text = request.Title;
		MessageLabel.AutomationId = $"{request.AutomationIdPrefix}Message";
		MessageLabel.Text = request.Message;
		BuildActions(request);
#if WINDOWS
		// Esc dismissal for keyboard users (#2766): window-scoped
		// accelerators sit in a different XAML subtree than the popup, so
		// the card carries its own — it is an ancestor of every focusable
		// element inside the dialog. Resolves to the safe-dismiss (null)
		// outcome like outside-tap and system Back.
		Card.HandlerChanged += (_, _) =>
		{
			if (Card.Handler?.PlatformView is Microsoft.UI.Xaml.UIElement element)
			{
				var esc = new Microsoft.UI.Xaml.Input.KeyboardAccelerator
				{
					Key = Windows.System.VirtualKey.Escape,
				};
				esc.Invoked += (s, args) =>
				{
					args.Handled = true;
					_ = DismissByDesktopInputAsync();
				};
				element.KeyboardAccelerators.Add(esc);
			}
		};
#endif
	}

	/// <summary>
	/// Dismisses the newest open dialog with the safe-dismiss (null) result.
	/// Called by the desktop Esc/Back pipelines before they reach the page
	/// underneath; returns false when no dialog is open so the press can
	/// continue down the surface chain.
	/// </summary>
	internal static bool TryDismissTopmost()
	{
		for (var i = _openDialogs.Count - 1; i >= 0; i--)
		{
			var top = _openDialogs[i];
			_openDialogs.RemoveAt(i);
			if (top.TryGetTarget(out var popup))
			{
				_ = popup.DismissByDesktopInputAsync();
				return true;
			}
		}

		return false;
	}

	/// <summary>Safe-dismiss close — same null resolution as outside-tap.</summary>
	private async Task DismissByDesktopInputAsync()
	{
		if (_completed)
		{
			return;
		}

		_completed = true;
		await CloseAsync(null!);
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

		var registration = new WeakReference<AppDialogPopup>(popup);
		_openDialogs.Add(registration);
		try
		{
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
		finally
		{
			_openDialogs.Remove(registration);
		}
	}
}
