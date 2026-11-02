using BibleOnSite.Controls;
using Microsoft.Maui.Handlers;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Maui.Platform;

namespace BibleOnSite.Handlers;

/// <summary>
/// Wraps the flyout destination row in a native WinUI Button (#2766).
/// The row's MAUI content (icon/title/subtitle/chevron grid) is hosted as
/// the Button's content, so the platform supplies tab focus, Enter/Space
/// activation, pointer hover/pressed visuals, the keyboard focus
/// rectangle and a readable automation name while the shared MAUI layout
/// keeps identical visuals on every platform.
/// </summary>
public sealed class FlyoutMenuRowHandler : ViewHandler<FlyoutMenuRow, Microsoft.UI.Xaml.Controls.Button>
{
	public static readonly IPropertyMapper<FlyoutMenuRow, FlyoutMenuRowHandler> Mapper =
		new PropertyMapper<FlyoutMenuRow, FlyoutMenuRowHandler>(ViewMapper)
		{
			[nameof(FlyoutMenuRow.Title)] = MapPresentation,
			[nameof(FlyoutMenuRow.Subtitle)] = MapPresentation,
			[SemanticProperties.DescriptionProperty.PropertyName] = MapPresentation,
			[ToolTipProperties.TextProperty.PropertyName] = MapPresentation,
		};

	public FlyoutMenuRowHandler() : base(Mapper)
	{
	}

	protected override Microsoft.UI.Xaml.Controls.Button CreatePlatformView()
	{
		var button = new Microsoft.UI.Xaml.Controls.Button
		{
			// Transparent at rest; WinUI's visual states still paint the
			// theme PointerOver/Pressed brushes and the focus rectangle.
			Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Transparent),
			BorderThickness = new Microsoft.UI.Xaml.Thickness(0),
			Padding = new Microsoft.UI.Xaml.Thickness(0),
			CornerRadius = new Microsoft.UI.Xaml.CornerRadius(6),
			HorizontalAlignment = Microsoft.UI.Xaml.HorizontalAlignment.Stretch,
			HorizontalContentAlignment = Microsoft.UI.Xaml.HorizontalAlignment.Stretch,
			VerticalContentAlignment = Microsoft.UI.Xaml.VerticalAlignment.Stretch,
		};
		return button;
	}

	protected override void ConnectHandler(Microsoft.UI.Xaml.Controls.Button platformView)
	{
		base.ConnectHandler(platformView);
		if (VirtualView.Content is { } content && MauiContext is { } context)
		{
			platformView.Content = content.ToPlatform(context);
		}
		platformView.Click += OnButtonClick;
	}

	protected override void DisconnectHandler(Microsoft.UI.Xaml.Controls.Button platformView)
	{
		platformView.Click -= OnButtonClick;
		platformView.Content = null;
		base.DisconnectHandler(platformView);
	}

	private void OnButtonClick(object sender, Microsoft.UI.Xaml.RoutedEventArgs e) => VirtualView.SendActivated();

	private static void MapPresentation(FlyoutMenuRowHandler handler, FlyoutMenuRow row)
	{
		if (handler.PlatformView is not { } button)
		{
			return;
		}

		var description = SemanticProperties.GetDescription(row) as string;
		var name = !string.IsNullOrWhiteSpace(description)
			? description
			: string.IsNullOrWhiteSpace(row.Subtitle) ? row.Title : $"{row.Title}, {row.Subtitle}";
		Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(button, name);
		ToolTipService.SetToolTip(button, ToolTipProperties.GetText(row));
	}
}
