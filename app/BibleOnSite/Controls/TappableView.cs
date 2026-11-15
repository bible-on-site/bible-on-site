using System.Windows.Input;

namespace BibleOnSite.Controls;

/// <summary>
/// A tappable row/card host for the Grid/Border/Label +
/// <see cref="TapGestureRecognizer"/> pattern used across the app (#3252).
/// Identical visuals on every platform; only the activation path differs.
/// On Windows the handler wraps the view in a native Button — the content
/// becomes Tab-focusable, Enter/Space-activatable and exposes the UIA
/// Invoke pattern a gesture-only element cannot provide. Other platforms
/// keep the original tap-gesture activation.
/// </summary>
public class TappableView : ContentView
{
	public static readonly BindableProperty CommandProperty =
		BindableProperty.Create(nameof(Command), typeof(ICommand), typeof(TappableView));

	public static readonly BindableProperty CommandParameterProperty =
		BindableProperty.Create(nameof(CommandParameter), typeof(object), typeof(TappableView));

	public ICommand? Command
	{
		get => (ICommand?)GetValue(CommandProperty);
		set => SetValue(CommandProperty, value);
	}

	public object? CommandParameter
	{
		get => GetValue(CommandParameterProperty);
		set => SetValue(CommandParameterProperty, value);
	}

	/// <summary>
	/// Raised on activation — native Button Click/Enter/Space on Windows,
	/// tap elsewhere. Carries <see cref="TappedEventArgs"/> so handlers
	/// written for TapGestureRecognizer (including <c>e.Parameter</c>,
	/// filled from <see cref="CommandParameter"/>) wire unchanged.
	/// </summary>
#pragma warning disable S3264 // Subscribed from XAML (Activated="...") and tests; generated event wiring is invisible to analyzers.
	public event EventHandler<TappedEventArgs>? Activated;
#pragma warning restore S3264

	/// <summary>
	/// Raises <see cref="Activated"/> and executes <see cref="Command"/>
	/// with <see cref="CommandParameter"/> — Button semantics: nothing
	/// happens while the view is disabled or the command refuses the
	/// parameter. Called by the Windows platform Button's Click and by
	/// the tap recognizer on touch platforms; invoked directly by tests.
	/// </summary>
	internal void SendActivated()
	{
		if (!IsEnabled)
		{
			return;
		}

		var command = Command;
		var parameter = CommandParameter;
		if (command is not null && !command.CanExecute(parameter))
		{
			return;
		}

		Activated?.Invoke(this, new TappedEventArgs(parameter));
		command?.Execute(parameter);
	}

	public TappableView()
	{
#if !WINDOWS
		// Touch platforms activate through the gesture recognizer; on
		// Windows the row's platform view IS the activatable Button —
		// a tap recognizer there would double-fire Activated alongside
		// Click (same contract as FlyoutMenuRow).
		var tap = new TapGestureRecognizer();
		tap.Tapped += (_, _) => SendActivated();
		GestureRecognizers.Add(tap);
#endif
	}
}
