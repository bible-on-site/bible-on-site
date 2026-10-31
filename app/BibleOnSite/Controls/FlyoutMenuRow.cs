namespace BibleOnSite.Controls;

/// <summary>
/// Flyout destination row: Fluent icon, Hebrew title + subtitle, trailing
/// chevron. Identical visuals on every platform; the activation path
/// differs. On Windows the handler wraps the row in a native Button
/// (#2766) — the row becomes focusable, Enter/Space-activatable, gets
/// pointer hover/pressed feedback, a focus rectangle and a readable
/// automation name for free. Other platforms keep the original
/// tap-gesture activation.
/// </summary>
public sealed class FlyoutMenuRow : ContentView
{
	public static readonly BindableProperty IconProperty =
		BindableProperty.Create(nameof(Icon), typeof(string), typeof(FlyoutMenuRow), string.Empty,
			propertyChanged: static (b, _, v) => ((FlyoutMenuRow)b)._iconLabel.Text = (string)v);

	public static readonly BindableProperty TitleProperty =
		BindableProperty.Create(nameof(Title), typeof(string), typeof(FlyoutMenuRow), string.Empty,
			propertyChanged: static (b, _, v) => ((FlyoutMenuRow)b)._titleLabel.Text = (string)v);

	public static readonly BindableProperty SubtitleProperty =
		BindableProperty.Create(nameof(Subtitle), typeof(string), typeof(FlyoutMenuRow), string.Empty,
			propertyChanged: static (b, _, v) => ((FlyoutMenuRow)b).ApplySubtitle((string)v));

	public string Icon
	{
		get => (string)GetValue(IconProperty);
		set => SetValue(IconProperty, value);
	}

	public string Title
	{
		get => (string)GetValue(TitleProperty);
		set => SetValue(TitleProperty, value);
	}

	public string Subtitle
	{
		get => (string)GetValue(SubtitleProperty);
		set => SetValue(SubtitleProperty, value);
	}

	/// <summary>
	/// Raised on tap (touch platforms) or native Button activation — click,
	/// Enter, Space (Windows). Wire this instead of a gesture recognizer.
	/// </summary>
#pragma warning disable S3264 // Subscribed from XAML (Activated="...") and tests; generated event wiring is invisible to analyzers.
	public event EventHandler? Activated;
#pragma warning restore S3264

	/// <summary>
	/// Raises <see cref="Activated"/>. Called by the Windows platform
	/// Button; invoked directly by tests on every platform.
	/// </summary>
	internal void SendActivated() => Activated?.Invoke(this, EventArgs.Empty);

	private readonly Label _iconLabel;
	private readonly Label _titleLabel;
	private readonly Label _subtitleLabel;

	public FlyoutMenuRow()
	{
		// Same three-column layout the AppShell flyout rows used to declare
		// inline: icon | title+subtitle stack | chevron.
		_iconLabel = new Label
		{
			FontFamily = "FluentIcons",
			FontSize = 24,
			VerticalOptions = LayoutOptions.Center,
			Margin = new Thickness(0, 0, 12, 0),
		};
		SetThemeColor(_iconLabel, Label.TextColorProperty, "Gray600", "Gray300");

		_titleLabel = new Label { FontSize = 16 };
		SetThemeColor(_titleLabel, Label.TextColorProperty, "Gray900", "Gray100");

		_subtitleLabel = new Label { FontSize = 12, IsVisible = false };
		SetThemeColor(_subtitleLabel, Label.TextColorProperty, "Gray500", "Gray400");

		var chevron = new Label
		{
			Text = Fonts.FluentUI.chevron_circle_left_12_regular,
			FontFamily = "FluentIcons",
			FontSize = 20,
			VerticalOptions = LayoutOptions.Center,
		};
		SetThemeColor(chevron, Label.TextColorProperty, "Gray400", "Gray500");

		var textColumn = new VerticalStackLayout
		{
			VerticalOptions = LayoutOptions.Center,
			Children = { _titleLabel, _subtitleLabel },
		};
		Grid.SetColumn(_iconLabel, 0);
		Grid.SetColumn(textColumn, 1);
		Grid.SetColumn(chevron, 2);

		Content = new Grid
		{
			Padding = new Thickness(16, 12),
			ColumnDefinitions = new ColumnDefinitionCollection(
				new ColumnDefinition(GridLength.Auto),
				new ColumnDefinition(GridLength.Star),
				new ColumnDefinition(GridLength.Auto)),
			Children = { _iconLabel, textColumn, chevron },
		};

#if !WINDOWS
		// Touch platforms activate through the gesture recognizer; on Windows
		// the row's platform view IS the activatable Button — a tap
		// recognizer there would double-fire Activated alongside Click.
		var tap = new TapGestureRecognizer();
		tap.Tapped += (_, _) => SendActivated();
		GestureRecognizers.Add(tap);
#endif
	}

	private void ApplySubtitle(string value)
	{
		_subtitleLabel.Text = value;
		_subtitleLabel.IsVisible = !string.IsNullOrEmpty(value);
	}

	/// <summary>
	/// Applies the same light/dark color pair the XAML rows declared via
	/// AppThemeBinding, resolved from the app resource keys so the palette
	/// stays single-sourced in Colors.xaml. No-ops in unit tests where no
	/// application resources exist.
	/// </summary>
	private static void SetThemeColor(BindableObject target, BindableProperty property, string lightKey, string darkKey)
	{
		if (Application.Current?.Resources is { } resources
			&& resources.TryGetValue(lightKey, out var light)
			&& resources.TryGetValue(darkKey, out var dark)
			&& light is Color lightColor && dark is Color darkColor)
		{
			target.SetAppThemeColor(property, lightColor, darkColor);
		}
	}
}
