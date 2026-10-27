using BibleOnSite.Helpers;
using Microsoft.Maui.Storage;
using Microsoft.UI.Input;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Input;
using Windows.Foundation;
using Windows.System;
using KeyboardAccelerator = Microsoft.UI.Xaml.Input.KeyboardAccelerator;
using MauiWindow = Microsoft.Maui.Controls.Window;
using WinWindow = Microsoft.UI.Xaml.Window;

namespace BibleOnSite;

/// <summary>
/// Shared Windows desktop layer attached once per MAUI window (#2766):
///
/// - Keyboard shortcuts on the window content root: Alt+Left and the mouse
///   Back button ride the same Back pipeline as the title-bar button
///   (flyout → page surfaces → in-app navigation); Esc peels transient
///   surfaces only and never navigates; Ctrl+F opens the reader search.
/// - Initial focus: after every Shell navigation, the current page's
///   <see cref="IWindowsDesktopSurface.FocusInitialElement"/> runs so a
///   keyboard-only session lands on a real focus target.
/// - Window placement: applies the persisted or default bounds at window
///   creation (before the platform window exists, so there is no visible
///   jump), tracks the normal (non-maximized) frame while running, and
///   persists "rect|maximized" on destroy — a maximized close restores
///   maximized with its previous normal rect.
///
/// The per-page triplicated Alt+Left wiring (Perek/Parasha/Masora
/// WindowsBack partials) was consolidated here; pages opt in by
/// implementing <see cref="IWindowsDesktopSurface"/>.
/// </summary>
internal sealed class DesktopWindowChrome
{
	private const string PlacementPreferenceKey = "BibleOnSite.WindowsWindowPlacement";

	private readonly MauiWindow _window;
	private readonly AppShell _shell;
	private readonly HashSet<Page> _focusHookedPages = new();

	private AppWindow? _appWindow;
	private DesktopRect _lastNormalBounds;
	private bool _hasNormalBounds;
	private bool _pendingMaximized;

	private DesktopWindowChrome(MauiWindow window, AppShell shell)
	{
		_window = window;
		_shell = shell;
	}

	/// <summary>
	/// Applies window minimums + saved/default placement (safe to call
	/// before the platform window exists — bounds are queued onto the MAUI
	/// Window and applied when it is created) and hooks the one-time
	/// platform wiring.
	/// </summary>
	public static void Attach(MauiWindow window, AppShell shell)
	{
		var chrome = new DesktopWindowChrome(window, shell);
		window.MinimumWidth = WindowPlacementPlan.MinWindowWidth;
		window.MinimumHeight = WindowPlacementPlan.MinWindowHeight;
		chrome.ApplyInitialPlacement();
		window.HandlerChanged += chrome.OnWindowHandlerChanged;
		window.Destroying += chrome.OnDestroying;
		shell.Navigated += chrome.OnNavigated;
	}

	#region Placement

	private void ApplyInitialPlacement()
	{
		// Before the platform window exists there is no per-monitor scale;
		// the primary display's density is the right approximation because
		// Windows creates new windows on the primary work area.
		var density = DeviceDisplay.MainDisplayInfo.Density;
		var primary = DisplayArea.Primary.WorkArea;
		var workArea = new DesktopRect(primary.X / density, primary.Y / density,
			primary.Width / density, primary.Height / density);

		DesktopRect bounds;
		if (WindowPlacementPlan.TryParse(
				Preferences.Default.Get<string?>(PlacementPreferenceKey, null),
				out var saved, out var maximized))
		{
			// Keep a saved position that still lands on ANY connected
			// display (multi-monitor restore); otherwise pull it back onto
			// the primary work area so the window can never be stranded.
			var displays = DisplayArea.FindAll();
			var onSomeDisplay = displays.Any(d => WindowPlacementPlan.Intersects(saved,
				new DesktopRect(d.WorkArea.X / density, d.WorkArea.Y / density,
					d.WorkArea.Width / density, d.WorkArea.Height / density)));
			bounds = onSomeDisplay ? saved : WindowPlacementPlan.ClampToWorkArea(saved, workArea);
			_pendingMaximized = maximized;
		}
		else
		{
			bounds = WindowPlacementPlan.InitialPlacement(workArea);
		}

		_window.X = bounds.X;
		_window.Y = bounds.Y;
		_window.Width = bounds.Width;
		_window.Height = bounds.Height;
		_lastNormalBounds = bounds;
		_hasNormalBounds = true;
	}

	private void TrackWindowChanges()
	{
		if (_appWindow is null)
		{
			return;
		}

		_appWindow.Changed += OnAppWindowChanged;
	}

	private void OnAppWindowChanged(AppWindow sender, AppWindowChangedEventArgs args)
	{
		if (_appWindow?.Presenter is not OverlappedPresenter presenter)
		{
			return;
		}

		// The MAUI Window's own X/Y/Width/Height report the maximized frame
		// while maximized, so the "normal" rect only updates while restored.
		if (presenter.State == OverlappedPresenterState.Restored
			&& (args.DidPositionChange || args.DidSizeChange))
		{
			_lastNormalBounds = new DesktopRect(_window.X, _window.Y, _window.Width, _window.Height);
			_hasNormalBounds = true;
		}
	}

	private void SavePlacement()
	{
		if (_appWindow?.Presenter is not OverlappedPresenter presenter)
		{
			return;
		}

		var maximized = presenter.State == OverlappedPresenterState.Maximized;
		if (!maximized && presenter.State == OverlappedPresenterState.Restored)
		{
			_lastNormalBounds = new DesktopRect(_window.X, _window.Y, _window.Width, _window.Height);
			_hasNormalBounds = true;
		}

		if (!_hasNormalBounds)
		{
			return;
		}

		Preferences.Default.Set(PlacementPreferenceKey,
			WindowPlacementPlan.Serialize(_lastNormalBounds, maximized));
	}

	private void OnDestroying(object? sender, EventArgs e) => SavePlacement();

	#endregion

	#region Platform wiring

	private void OnWindowHandlerChanged(object? sender, EventArgs e)
	{
		if (sender is not MauiWindow { Handler.PlatformView: WinWindow platformWindow })
		{
			return;
		}

		_appWindow = platformWindow.AppWindow;

		if (_pendingMaximized
			&& _appWindow?.Presenter is OverlappedPresenter presenter)
		{
			presenter.Maximize();
			_pendingMaximized = false;
		}

		TrackWindowChanges();
		AttachAccelerators(platformWindow);
		AttachMouseBack(platformWindow);
	}

	private void AttachAccelerators(WinWindow platformWindow)
	{
		if (platformWindow.Content is not UIElement owner)
		{
			return;
		}

		owner.KeyboardAccelerators.Add(Accelerator(VirtualKey.Left, VirtualKeyModifiers.Menu, OnBackAcceleratorInvoked));
		owner.KeyboardAccelerators.Add(Accelerator(VirtualKey.Escape, VirtualKeyModifiers.None, OnEscapeAcceleratorInvoked));
		owner.KeyboardAccelerators.Add(Accelerator(VirtualKey.F, VirtualKeyModifiers.Control, OnSearchAcceleratorInvoked));
	}

	private static KeyboardAccelerator Accelerator(
		VirtualKey key, VirtualKeyModifiers modifiers,
		TypedEventHandler<KeyboardAccelerator, KeyboardAcceleratorInvokedEventArgs> invoked)
	{
		var accelerator = new KeyboardAccelerator { Key = key, Modifiers = modifiers };
		accelerator.Invoked += invoked;
		return accelerator;
	}

	private void AttachMouseBack(WinWindow platformWindow)
	{
		if (platformWindow.Content is UIElement owner)
		{
			owner.PointerPressed += OnPreviewPointerPressed;
		}
	}

	private void OnPreviewPointerPressed(object sender, PointerRoutedEventArgs args)
	{
		var kind = args.GetCurrentPoint(null).Properties.PointerUpdateKind;
		if (kind == PointerUpdateKind.XButton1Pressed)
		{
			args.Handled = true;
			RunBack();
		}
	}

	private void OnBackAcceleratorInvoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
	{
		args.Handled = true;
		RunBack();
	}

	private void OnEscapeAcceleratorInvoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
	{
		args.Handled = RunEscape();
	}

	private void OnSearchAcceleratorInvoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
	{
		if (_shell.CurrentPage is IWindowsSearchSurface search)
		{
			args.Handled = true;
			search.OpenDesktopSearch();
		}
	}

	/// <summary>
	/// Back ordering shared by Alt+Left and the mouse Back button. The
	/// flyout is topmost: while it is presented Back closes it and nothing
	/// underneath is touched. Then the page peels its own transient
	/// surfaces; only when nothing was dismissed does the press become
	/// in-app navigation through the same IWindow.BackButtonClicked
	/// pipeline as the title-bar button (which owns the exit confirmation).
	/// </summary>
	private void RunBack()
	{
		var surfaceDismissed = !_shell.FlyoutIsPresented
			&& (_shell.CurrentPage as IWindowsDesktopSurface)?.DismissTopmostSurface() == true;

		var route = DesktopInputPlan.EvaluateBack(
			_shell.FlyoutIsPresented, surfaceDismissed, _shell.Navigation.NavigationStack.Count > 1);
		if (route == DesktopBackRoute.CloseFlyout)
		{
			_shell.FlyoutIsPresented = false;
		}
		else if (route == DesktopBackRoute.NavigateBack)
		{
			_ = ((Microsoft.Maui.IWindow)_window).BackButtonClicked();
		}
	}

	/// <summary>
	/// Escape only peels transient layers — it never navigates and never
	/// exits, mirroring how Windows dialogs behave.
	/// </summary>
	private bool RunEscape()
	{
		var surfaceDismissed = !_shell.FlyoutIsPresented
			&& (_shell.CurrentPage as IWindowsDesktopSurface)?.DismissTopmostSurface() == true;
		if (!DesktopInputPlan.EvaluateEscape(_shell.FlyoutIsPresented, surfaceDismissed))
		{
			return false;
		}

		if (_shell.FlyoutIsPresented)
		{
			_shell.FlyoutIsPresented = false;
		}

		return true;
	}

	#endregion

	#region Initial focus

	private void OnNavigated(object? sender, ShellNavigatedEventArgs e)
	{
		if (_shell.CurrentPage is not { } page || page is not IWindowsDesktopSurface surface)
		{
			return;
		}

		page.Dispatcher.Dispatch(() => surface.FocusInitialElement());
		if (_focusHookedPages.Add(page))
		{
			page.HandlerChanged += OnPageHandlerChanged;
		}
	}

	private void OnPageHandlerChanged(object? sender, EventArgs e)
	{
		if (sender is Page page)
		{
			page.Dispatcher.Dispatch(() => (page as IWindowsDesktopSurface)?.FocusInitialElement());
		}
	}

	#endregion
}
