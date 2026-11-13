using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using Microsoft.Maui.Handlers;
using Microsoft.Maui.Platform;
using Microsoft.UI.Xaml.Controls;
using AutomationProperties = Microsoft.UI.Xaml.Automation.AutomationProperties;

namespace BibleOnSite.Handlers;

/// <summary>
/// Wraps a <see cref="TappableView"/> in a native WinUI Button (#3252).
/// The MAUI content (row/card/chip visuals) is hosted as the Button's
/// content, so the platform supplies tab focus, Enter/Space activation,
/// pointer hover/pressed visuals, the keyboard focus rectangle and a UIA
/// Invoke pattern — the capabilities a gesture-only container cannot
/// expose. The automation name comes from SemanticProperties.Description
/// when authored and otherwise from the row's own visible text.
/// </summary>
public sealed class TappableViewHandler : ViewHandler<TappableView, Microsoft.UI.Xaml.Controls.Button>
{
	public static readonly IPropertyMapper<TappableView, TappableViewHandler> Mapper =
		new PropertyMapper<TappableView, TappableViewHandler>(ViewMapper)
		{
			[nameof(TappableView.Content)] = MapContent,
			[SemanticProperties.DescriptionProperty.PropertyName] = MapPresentation,
			[SemanticProperties.HintProperty.PropertyName] = MapPresentation,
			[ToolTipProperties.TextProperty.PropertyName] = MapPresentation,
		};

	public TappableViewHandler() : base(Mapper)
	{
	}

	protected override Microsoft.UI.Xaml.Controls.Button CreatePlatformView() => NativeRowButton.Create();

	protected override void ConnectHandler(Microsoft.UI.Xaml.Controls.Button platformView)
	{
		base.ConnectHandler(platformView);
		platformView.Click += OnButtonClick;
		// The name is collected from the row's visible text — refresh it on
		// the events that precede a screen-reader or pointer query so text
		// bound or changed after connect (filter chips, summaries) reads
		// current rather than stale.
		platformView.Loaded += OnPlatformEvent;
		platformView.GotFocus += OnPlatformEvent;
		platformView.PointerEntered += OnPlatformEvent;
		MapContent(this, VirtualView);
		MapPresentation(this, VirtualView);
	}

	protected override void DisconnectHandler(Microsoft.UI.Xaml.Controls.Button platformView)
	{
		platformView.Click -= OnButtonClick;
		platformView.Loaded -= OnPlatformEvent;
		platformView.GotFocus -= OnPlatformEvent;
		platformView.PointerEntered -= OnPlatformEvent;
		platformView.Content = null;
		base.DisconnectHandler(platformView);
	}

	private void OnButtonClick(object sender, Microsoft.UI.Xaml.RoutedEventArgs e) => VirtualView.SendActivated();

	private void OnPlatformEvent(object sender, Microsoft.UI.Xaml.RoutedEventArgs e) => MapPresentation(this, VirtualView);

	private static void MapContent(TappableViewHandler handler, TappableView view)
	{
		if (handler.PlatformView is { } button && handler.MauiContext is { } context)
		{
			NativeRowButton.SetContent(button, view.Content, context);
		}
	}

	private static void MapPresentation(TappableViewHandler handler, TappableView view)
	{
		if (handler.PlatformView is not { } button)
		{
			return;
		}

		var description = SemanticProperties.GetDescription(view) as string;
		AutomationProperties.SetName(button, !string.IsNullOrWhiteSpace(description)
			? description
			: AccessibleContentText.ComposeName(view));
		AutomationProperties.SetHelpText(button, SemanticProperties.GetHint(view) as string ?? string.Empty);
		ToolTipService.SetToolTip(button, ToolTipProperties.GetText(view));
	}
}
