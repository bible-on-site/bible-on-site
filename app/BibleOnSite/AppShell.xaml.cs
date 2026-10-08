using BibleOnSite.Config;
using BibleOnSite.Pages;
using BibleOnSite.Services;

#if IOS || MACCATALYST
using UIKit;
#endif

namespace BibleOnSite;

public partial class AppShell : Shell
{
	public AppShell()
	{
		InitializeComponent();

#if IOS || MACCATALYST
		// On iOS/MacCatalyst, Shell flyout is always presented from the left. Force RTL on the native
		// root so the flyout opens from the right and is triggered by a right-edge swipe (like Android).
		HandlerChanged += OnShellHandlerChanged;
#endif

		// Register routes for pages that are navigated to with parameters
		Routing.RegisterRoute("ArticlesPage", typeof(ArticlesPage));
		Routing.RegisterRoute("AuthorsPage", typeof(AuthorsPage));
		Routing.RegisterRoute("articleDetail", typeof(ArticleDetailPage));
		Routing.RegisterRoute("ContactPage", typeof(ContactPage));
		Routing.RegisterRoute("DonationsPage", typeof(DonationsPage));
		Routing.RegisterRoute("TosPage", typeof(TosPage));
		Routing.RegisterRoute("PreferencesPage", typeof(PreferencesPage));

		Navigated += OnNavigated;
	}

	internal void CompleteStartup()
	{
		if (ReaderContent.Content is PerekPage)
		{
			return;
		}

		// Reuse the startup ShellContent instead of creating a second native root.
		// Clear the template first so MAUI replaces its cached loading page too.
		var reader = new PerekPage();
		ReaderContent.ContentTemplate = null;
		ReaderContent.Content = reader;
	}

#if IOS || MACCATALYST
	private UIView? _flyoutEdgeView;

	/// <summary>
	/// MAUI's built-in Shell flyout gesture is bound to the left screen edge even
	/// under ForceRightToLeft — the drawer slides in from the right but only a
	/// left-edge swipe opens it. This recognizer opens the flyout on the RTL
	/// gesture (right edge toward left).
	/// One shared instance: the perek carousel's native pan is wired to yield to
	/// exactly this recognizer (MauiProgram), so recreating it would silently
	/// drop that priority and let carousel paging swallow the edge swipe again.
	/// </summary>
	internal static readonly UIPanGestureRecognizer SharedFlyoutEdgePan = CreateFlyoutEdgePan();

	private static UIPanGestureRecognizer CreateFlyoutEdgePan()
	{
		var pan = new UIPanGestureRecognizer(OnSharedFlyoutEdgePan);
		pan.ShouldReceiveTouch += OnFlyoutEdgePanShouldReceiveTouch;
		pan.ShouldBegin += OnFlyoutEdgePanShouldBegin;
		return pan;
	}

	private static bool OnFlyoutEdgePanShouldReceiveTouch(UIGestureRecognizer recognizer, UITouch touch)
	{
		if (recognizer.View is not UIView view || Current is not AppShell shell || shell.FlyoutIsPresented)
		{
			return false;
		}
		// Honor the selection-mode lock: when a pasuk is selected the page
		// sets FlyoutBehavior.Disabled and the drawer must stay closed.
		if (shell.CurrentPage is null ||
			GetFlyoutBehavior(shell.CurrentPage) != FlyoutBehavior.Flyout)
		{
			return false;
		}
		// MAUI's own flyout pan only engages in the left 10% band; mirror it on
		// the right edge for the RTL drawer so ordinary carousel swipes keep paging.
		var x = touch.LocationInView(view).X;
		var allowed = x >= view.Frame.Width * 0.9;
		if (x >= view.Frame.Width * 0.5 || allowed)
		{
			Console.WriteLine($"[EdgePan] ShouldReceiveTouch x={x:F1} width={view.Frame.Width:F1} page={shell.CurrentPage?.GetType().Name} behavior={GetFlyoutBehavior(shell.CurrentPage)} => {allowed}");
		}
		return allowed;
	}

	private static bool OnFlyoutEdgePanShouldBegin(UIGestureRecognizer recognizer)
	{
		if (recognizer is not UIPanGestureRecognizer pan || pan.View is null)
		{
			return false;
		}
		// Commit only to a clear leftward pull — a vertical drag at the right
		// edge must keep scrolling the page instead of opening the drawer.
		var translation = pan.TranslationInView(pan.View);
		var allowed = translation.X < 0 && Math.Abs(translation.X) > Math.Abs(translation.Y);
		Console.WriteLine($"[EdgePan] ShouldBegin translation=({translation.X:F1},{translation.Y:F1}) => {allowed}");
		return allowed;
	}

	private static void OnSharedFlyoutEdgePan(UIPanGestureRecognizer pan)
	{
		Console.WriteLine($"[EdgePan] fired state={pan.State} flyoutPresented={Current?.FlyoutIsPresented}");
		if (Current is AppShell shell && !shell.FlyoutIsPresented)
		{
			shell.FlyoutIsPresented = true;
		}
	}

	private void OnShellHandlerChanged(object? sender, EventArgs e)
	{
		if (Handler?.PlatformView is UIView uiView)
		{
			uiView.SemanticContentAttribute = UISemanticContentAttribute.ForceRightToLeft;
			InstallRightEdgeFlyoutGesture(uiView);
		}
	}

	private void InstallRightEdgeFlyoutGesture(UIView uiView)
	{
		// The recognizer must live on the UIWindow — the only view guaranteed to
		// be an ancestor of every touch target. The shell renderer manages its
		// flyout/detail controllers in a subtree that can sit beside (not inside)
		// the handler's platform view, which left the edge gesture dead (#1306).
		var host = uiView.Window ?? FindKeyWindow() ?? uiView;
		if (_flyoutEdgeView is not null && !ReferenceEquals(_flyoutEdgeView, host))
		{
			_flyoutEdgeView.RemoveGestureRecognizer(SharedFlyoutEdgePan);
			_flyoutEdgeView = null;
		}
		if (_flyoutEdgeView is not null)
		{
			return;
		}

		host.AddGestureRecognizer(SharedFlyoutEdgePan);
		_flyoutEdgeView = host;
		Console.WriteLine($"[EdgePan] attached host={host.GetType().Name} frame={host.Frame} platformView={uiView.GetType().Name} inWindow={uiView.Window != null}");
	}

	private static UIWindow? FindKeyWindow()
	{
		var windows = UIApplication.SharedApplication.ConnectedScenes
			.OfType<UIWindowScene>()
			.SelectMany(scene => scene.Windows)
			.ToList();
		return windows.FirstOrDefault(window => window.IsKeyWindow) ?? windows.FirstOrDefault();
	}
#endif

	private void OnNavigated(object? sender, ShellNavigatedEventArgs e)
	{
		var analytics = Application.Current?.Handler?.MauiContext?.Services.GetService<IAnalyticsService>();
		if (analytics == null) return;
		// Populate analytics with route (legacy-style: clear screen names for GA)
		var loc = e.Current?.Location?.ToString();
		if (!string.IsNullOrEmpty(loc))
			analytics.SetScreen(loc.TrimStart('/'), "Shell");
	}

	private async void OnAlHaperekTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToAsync(AppRoutes.FlyoutPage("PerekPage"));
	}

	private async void OnAuthorsTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToAsync(AppRoutes.FlyoutPage("AuthorsPage"));
	}

	private async void OnTermsTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToAsync(AppRoutes.FlyoutPage("TosPage"));
	}

	private async void OnPreferencesTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToAsync(AppRoutes.FlyoutPage("PreferencesPage"));
	}

	private async void OnContactTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToAsync(AppRoutes.FlyoutPage("ContactPage"));
	}

	private async void OnDonationsTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToAsync(AppRoutes.FlyoutPage("DonationsPage"));
	}
}
