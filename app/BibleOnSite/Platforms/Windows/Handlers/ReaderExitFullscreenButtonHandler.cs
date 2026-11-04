using BibleOnSite.Controls;
using Microsoft.Maui.Handlers;
using Microsoft.Maui.Platform;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;

namespace BibleOnSite.Handlers;

/// <summary>
/// Hosts the floating exit-fullscreen circle in a native WinUI Button
/// (#2766): the control becomes a tab stop with Enter/Space activation, a
/// focus rectangle, hover/pressed visuals and the automation name/tooltip it
/// already declares — while keeping its drag-to-reposition behavior, which
/// the handler implements directly on pointer events (a press that never
/// travels is a click; past the slop it becomes a drag and the Click is
/// suppressed).
/// </summary>
public sealed class ReaderExitFullscreenButtonHandler
	: ViewHandler<ReaderExitFullscreenButton, Microsoft.UI.Xaml.Controls.Button>
{
	/// <summary>Pointer travel (dips) that turns a press into a drag.</summary>
	private const double DragSlop = 6;

	public static readonly IPropertyMapper<ReaderExitFullscreenButton, ReaderExitFullscreenButtonHandler> Mapper =
		new PropertyMapper<ReaderExitFullscreenButton, ReaderExitFullscreenButtonHandler>(ViewMapper)
		{
			[SemanticProperties.DescriptionProperty.PropertyName] = MapPresentation,
			[ToolTipProperties.TextProperty.PropertyName] = MapPresentation,
		};

	private Windows.Foundation.Point _pressOrigin;
	private double _dragStartX;
	private double _dragStartY;
	private bool _pressed;
	private bool _dragged;
	// Armed only by a dragged pointer release: suppresses that release's own
	// trailing Click. Auto-clears on the next dispatcher pass so a release
	// that produced no Click (pointer left the button, capture lost) cannot
	// swallow a later keyboard Enter/Space activation.
	private bool _suppressClick;
	private readonly PointerEventHandler _onPointerPressed;
	private readonly PointerEventHandler _onPointerMoved;
	private readonly PointerEventHandler _onPointerReleased;

	public ReaderExitFullscreenButtonHandler() : base(Mapper)
	{
		// Instances so DisconnectHandler can remove the same delegates —
		// AddHandler-registered handlers need their original delegate.
		_onPointerPressed = OnPointerPressed;
		_onPointerMoved = OnPointerMoved;
		_onPointerReleased = OnPointerReleased;
	}

	protected override Microsoft.UI.Xaml.Controls.Button CreatePlatformView()
	{
		return new Microsoft.UI.Xaml.Controls.Button
		{
			CornerRadius = new Microsoft.UI.Xaml.CornerRadius(24),
			Padding = new Microsoft.UI.Xaml.Thickness(0),
			BorderThickness = new Microsoft.UI.Xaml.Thickness(0),
			HorizontalContentAlignment = Microsoft.UI.Xaml.HorizontalAlignment.Center,
			VerticalContentAlignment = Microsoft.UI.Xaml.VerticalAlignment.Center,
		};
	}

	protected override void ConnectHandler(Microsoft.UI.Xaml.Controls.Button platformView)
	{
		base.ConnectHandler(platformView);
		if (VirtualView.Content is { } content && MauiContext is { } context)
		{
			platformView.Content = content.ToPlatform(context);
		}

		platformView.Click += OnButtonClick;
		// handledEventsToo: ButtonBase consumes pointer presses for its own
		// visuals — the drag must still see them.
		platformView.AddHandler(UIElement.PointerPressedEvent, _onPointerPressed, true);
		platformView.AddHandler(UIElement.PointerMovedEvent, _onPointerMoved, true);
		platformView.AddHandler(UIElement.PointerReleasedEvent, _onPointerReleased, true);
		platformView.PointerCaptureLost += OnPointerCaptureLost;
	}

	protected override void DisconnectHandler(Microsoft.UI.Xaml.Controls.Button platformView)
	{
		platformView.Click -= OnButtonClick;
		platformView.RemoveHandler(UIElement.PointerPressedEvent, _onPointerPressed);
		platformView.RemoveHandler(UIElement.PointerMovedEvent, _onPointerMoved);
		platformView.RemoveHandler(UIElement.PointerReleasedEvent, _onPointerReleased);
		platformView.PointerCaptureLost -= OnPointerCaptureLost;
		platformView.Content = null;
		_pressed = false;
		_dragged = false;
		base.DisconnectHandler(platformView);
	}

	private void OnButtonClick(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
	{
		if (_suppressClick)
		{
			// The dragged release's own Click — the move already did its
			// work; it must not also exit fullscreen.
			_suppressClick = false;
			return;
		}

		VirtualView.SendExitRequested();
	}

	private void OnPointerPressed(object sender, PointerRoutedEventArgs e)
	{
		if (PlatformView is not { } button)
		{
			return;
		}

		_pressed = true;
		_dragged = false;
		// Root-space coordinates: the button translates under the pointer as
		// the drag moves it, so a button-relative point would collapse every
		// delta back toward zero (the same reason Android uses RawX/Y).
		_pressOrigin = e.GetCurrentPoint(null).Position;
		_dragStartX = VirtualView.TranslationX;
		_dragStartY = VirtualView.TranslationY;
		button.CapturePointer(e.Pointer);
	}

	private void OnPointerMoved(object sender, PointerRoutedEventArgs e)
	{
		if (!_pressed || PlatformView is null)
		{
			return;
		}

		var point = e.GetCurrentPoint(null).Position;
		var dx = point.X - _pressOrigin.X;
		var dy = point.Y - _pressOrigin.Y;
		if (!_dragged && Math.Abs(dx) < DragSlop && Math.Abs(dy) < DragSlop)
		{
			return;
		}

		_dragged = true;
		VirtualView.TranslationX = _dragStartX + dx;
		VirtualView.TranslationY = _dragStartY + dy;
	}

	private void OnPointerReleased(object sender, PointerRoutedEventArgs e)
	{
		_pressed = false;
		PlatformView?.ReleasePointerCapture(e.Pointer);
		if (_dragged)
		{
			_dragged = false;
			_suppressClick = true;
			PlatformView?.DispatcherQueue.TryEnqueue(() => _suppressClick = false);
		}
	}

	private void OnPointerCaptureLost(object sender, PointerRoutedEventArgs e)
	{
		// Capture loss ends the gesture without a Click — nothing to suppress.
		_pressed = false;
		_dragged = false;
	}

	private static void MapPresentation(ReaderExitFullscreenButtonHandler handler, ReaderExitFullscreenButton view)
	{
		if (handler.PlatformView is not { } button)
		{
			return;
		}

		Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(button,
			SemanticProperties.GetDescription(view) as string ?? string.Empty);
		ToolTipService.SetToolTip(button, ToolTipProperties.GetText(view));
	}
}
