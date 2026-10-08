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
	internal static readonly UIScreenEdgePanGestureRecognizer SharedFlyoutEdgePan =
		new UIScreenEdgePanGestureRecognizer(OnSharedFlyoutEdgePan)
		{
			Edges = UIRectEdge.Right,
		};

	private static void OnSharedFlyoutEdgePan()
	{
		if (Current is AppShell shell)
		{
			shell.OpenFlyoutFromRightEdgePan();
		}
	}

	private void OpenFlyoutFromRightEdgePan()
	{
		// Honor the selection-mode lock: when a pasuk is selected the page
		// sets FlyoutBehavior.Disabled and the drawer must stay closed.
		if (CurrentPage is not null &&
			GetFlyoutBehavior(CurrentPage) == FlyoutBehavior.Flyout &&
			!FlyoutIsPresented)
		{
			FlyoutIsPresented = true;
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
		// If Shell replaced its native view, move the recognizer to the new one
		// instead of leaving it on the old view holding a callback into us.
		if (_flyoutEdgeView is not null && !ReferenceEquals(_flyoutEdgeView, uiView))
		{
			_flyoutEdgeView.RemoveGestureRecognizer(SharedFlyoutEdgePan);
			_flyoutEdgeView = null;
		}
		if (_flyoutEdgeView is not null)
		{
			return;
		}

		uiView.AddGestureRecognizer(SharedFlyoutEdgePan);
		_flyoutEdgeView = uiView;
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
