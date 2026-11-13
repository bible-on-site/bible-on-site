using Microsoft.Maui.Platform;

namespace BibleOnSite.Handlers;

/// <summary>
/// The shared WinUI Button chrome behind activatable row controls (#2766,
/// #3252): transparent at rest so the MAUI content keeps its own visuals,
/// while WinUI's visual states still paint the theme PointerOver/Pressed
/// brushes and the keyboard focus rectangle.
/// </summary>
internal static class NativeRowButton
{
	public static Microsoft.UI.Xaml.Controls.Button Create()
	{
		var button = new Microsoft.UI.Xaml.Controls.Button
		{
			Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Transparent),
			BorderThickness = new Microsoft.UI.Xaml.Thickness(0),
			Padding = new Microsoft.UI.Xaml.Thickness(0),
			CornerRadius = new Microsoft.UI.Xaml.CornerRadius(6),
			HorizontalAlignment = Microsoft.UI.Xaml.HorizontalAlignment.Stretch,
			HorizontalContentAlignment = Microsoft.UI.Xaml.HorizontalAlignment.Stretch,
			VerticalContentAlignment = Microsoft.UI.Xaml.VerticalAlignment.Stretch,
		};

		// WinUI's Button visual states paint {ThemeResource ButtonBackground*}
		// on the template root, which beats the local Background property — so
		// a resting row renders the subtle elevated grey instead of staying
		// invisible. Rebinding the resource keys on this instance keeps the
		// resting chrome transparent while PointerOver/Pressed and the focus
		// rectangle keep their theme feedback (#3252).
		var transparent = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Transparent);
		button.Resources["ButtonBackground"] = transparent;
		button.Resources["ButtonBackgroundDisabled"] = transparent;
		button.Resources["ButtonBorderBrush"] = transparent;
		return button;
	}

	/// <summary>
	/// Hosts MAUI content inside the row button. <c>ToPlatform</c> creates
	/// left-to-right platform views while every app page pins an RTL flow
	/// direction: an element whose flow direction differs from its parent's
	/// gets its render rect mirrored across the parent, which flings the
	/// content past the window's right edge (#3252). Pinning the hosted view
	/// to the direction MAUI resolved for it keeps the RTL layout inside the
	/// button instead of a mirrored duplicate outside it.
	/// </summary>
	public static void SetContent(Microsoft.UI.Xaml.Controls.Button button, Microsoft.Maui.IView? content, Microsoft.Maui.IMauiContext context)
	{
		var platformContent = content?.ToPlatform(context);
		if (platformContent is not null)
		{
			var direction = ResolveFlowDirection(content);
			platformContent.FlowDirection = direction;
			// The button itself must share the direction: a flow-direction
			// mismatch between presenter and content mirrors the content's
			// render rect off the button's bounds.
			button.FlowDirection = direction;
		}
		button.Content = platformContent;
	}

	private static Microsoft.UI.Xaml.FlowDirection ResolveFlowDirection(Microsoft.Maui.IView? view)
	{
		for (Element? element = view as Element; element is not null; element = element.Parent)
		{
			// Only explicit directions count: MatchParent means "not decided
			// here", so keep walking to the ancestor that pins the flow.
			if (element is VisualElement visual &&
				visual.FlowDirection is Microsoft.Maui.FlowDirection.LeftToRight)
			{
				return Microsoft.UI.Xaml.FlowDirection.LeftToRight;
			}
			if (element is VisualElement rtlVisual &&
				rtlVisual.FlowDirection is Microsoft.Maui.FlowDirection.RightToLeft)
			{
				return Microsoft.UI.Xaml.FlowDirection.RightToLeft;
			}
		}
		return Microsoft.UI.Xaml.FlowDirection.RightToLeft;
	}
}
