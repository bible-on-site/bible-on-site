using BibleOnSite.Config;
using BibleOnSite.Helpers;
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

		// The flyout's scrollable content is laid out beneath FlyoutHeader on iOS
		// (the header height is applied as a scroll inset that can fail to apply,
		// leaving the first menu rows permanently hidden under the opaque header).
		// The logo is rendered inside the scrolling content instead.
		FlyoutHeader = null;
#endif

		// Register routes for pages that are navigated to with parameters
		Routing.RegisterRoute("ArticlesPage", typeof(ArticlesPage));
		Routing.RegisterRoute("AuthorsPage", typeof(AuthorsPage));
		Routing.RegisterRoute("articleDetail", typeof(ArticleDetailPage));
		Routing.RegisterRoute("ContactPage", typeof(ContactPage));
		Routing.RegisterRoute("DonationsPage", typeof(DonationsPage));
		Routing.RegisterRoute("TosPage", typeof(TosPage));
		Routing.RegisterRoute("PreferencesPage", typeof(PreferencesPage));
		Routing.RegisterRoute("TanahpediaPage", typeof(TanahpediaPage));
		Routing.RegisterRoute("tanahpediaCategory", typeof(TanahpediaEntityTypePage));
		Routing.RegisterRoute("tanahpediaEntry", typeof(TanahpediaEntryPage));
		Routing.RegisterRoute(AppRoutes.RecitationPreferences, typeof(RecitationPreferencesPage));
		Routing.RegisterRoute(AppRoutes.DisplayPreferences, typeof(DisplayPreferencesPage));
		Routing.RegisterRoute(AppRoutes.PerekPreferences, typeof(PerekPreferencesPage));
		Routing.RegisterRoute(AppRoutes.ExtensionPacks, typeof(ExtensionPacksPage));
		Routing.RegisterRoute(AppRoutes.SoundPreferences, typeof(SoundPreferencesPage));
		Routing.RegisterRoute(AppRoutes.SupportPreferences, typeof(SupportPreferencesPage));
		Routing.RegisterRoute("ParashaListPage", typeof(ParashaListPage));
		Routing.RegisterRoute("ParashaPage", typeof(ParashaPage));
		Routing.RegisterRoute(AppRoutes.LearningCalendar, typeof(LearningCalendarPage));
		Routing.RegisterRoute(AppRoutes.CalendarReader, typeof(PerekPage));
		Routing.RegisterRoute(AppRoutes.SearchReader, typeof(PerekPage));
		Routing.RegisterRoute(AppRoutes.Masora, typeof(MasoraPage));

		// One styled presenter for every blocking dialog — alerts, confirmations
		// and the exit/stay prompt — so colors, order, radius and typography
		// cannot drift between call sites (#2630). The exit dialog keeps its
		// theme-blue "stay" and red "exit" text via the shared roles (#2460).
		AppDialogs.UsePresenter(Controls.AppDialogPopup.ShowAsync);

		Navigating += OnShellNavigating;
		Navigated += OnNavigated;

		// Re-apply the Back/Up visibility policy to the open page when the
		// Android override changes, not only to pages navigated to later (#2467).
		WeakPreferencesSubscription.Subscribe(this, PreferencesService.Instance,
			static shell => shell.ApplyBackChrome());
	}

	private void ApplyBackChrome()
	{
		if (CurrentPage is ContentPage page)
		{
			BackChrome.Apply(page);
		}
	}

	/// <summary>
	/// True while a Shell navigation transition is still settling. Back presses
	/// that land inside that window are consumed rather than fed back into the
	/// base pipeline — a second pass can pop the page beneath the one already
	/// transitioning out and leave an empty surface after "stay" (#2460).
	/// </summary>
	private bool _navigationInFlight;

	private void OnShellNavigating(object? sender, ShellNavigatingEventArgs e) => _navigationInFlight = true;

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

		// The content swap never passes through OnNavigated, so the startup
		// reader would otherwise keep the capsule's platform default until the
		// first navigation — the persisted Back preference must hold from the
		// first frame (#2467). Loaded waits for the swapped visual tree.
		reader.Loaded += (_, _) => BackChrome.Apply(reader);
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

	/// <summary>
	/// The perek carousel's scroll pan can begin on the same edge swipe in the
	/// same touch-move pass; UIKit's default lets the first recognizer to begin
	/// force every other candidate to Failed without dispatching its action.
	/// An edge recognizer that cannot be prevented survives that race.
	/// </summary>
	private sealed class FlyoutEdgePanGestureRecognizer(Action<UIPanGestureRecognizer> action)
		: UIPanGestureRecognizer(action)
	{
		public override bool CanBePreventedByGestureRecognizer(UIGestureRecognizer other) => false;
	}

	private static UIPanGestureRecognizer CreateFlyoutEdgePan()
	{
		var pan = new FlyoutEdgePanGestureRecognizer(OnSharedFlyoutEdgePan);
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
			GetFlyoutBehavior(shell.CurrentPage) != FlyoutBehavior.Flyout ||
			shell.Navigation.NavigationStack.Count > 1)
		{
			// Above the root, iOS owns this edge for standard history Back.
			// The reader's hamburger still opens the drawer after a search jump.
			return false;
		}
		// MAUI's own flyout pan only engages in the left 10% band; mirror it on
		// the right edge for the RTL drawer so ordinary carousel swipes keep paging.
		return touch.LocationInView(view).X >= view.Frame.Width * 0.9;
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
		return translation.X < 0 && Math.Abs(translation.X) > Math.Abs(translation.Y);
	}

	private static void OnSharedFlyoutEdgePan(UIPanGestureRecognizer pan)
	{
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
		DebugLog.Write($"[EdgePan] attached host={host.GetType().Name} frame={host.Frame} platformView={uiView.GetType().Name} inWindow={uiView.Window != null}");
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

	/// <summary>
	/// Shared Back ordering for every Shell surface:
	/// 1. A fullscreen media surface is released first (#2117) — a transient
	///    surface always owns Back before page navigation or app exit.
	/// 2. The page/navigation pipeline then decides (reader overlays, section
	///    stack pops, cancelled navigation).
	/// 3. When nothing consumed the press and it would leave the app, the
	///    single-Back exit confirmation runs first (#2118).
	/// On Android, MainActivity's always-enabled AppBackPressedCallback
	/// guarantees this method receives every press — MAUI's own callback is
	/// disabled whenever CanConsumeBackNavigation reports no in-app history.
	/// </summary>
	protected override bool OnBackButtonPressed()
	{
		if (MediaFullscreen.TryExit())
		{
			return true;
		}

		return BackExitPlan.Evaluate(_navigationInFlight, base.OnBackButtonPressed, FlyoutIsPresented,
			Navigation.NavigationStack.Count > 1, RootBackMayExitApp) switch
		{
			BackExitAction.Consume => true,
			BackExitAction.ConfirmExit => ExitConfirmation.Shared.Request(),
			_ => false,
		};
	}

	/// <summary>
	/// Whether an unhandled root Back press can leave the app. Android's system
	/// Back can; iOS/MacCatalyst have no root Back source — the only consult
	/// reaching <see cref="OnBackButtonPressed"/> at the root is UIKit's
	/// interactive-pop recognizer, which can stay enabled a beat after the
	/// stack already settled there. Deferring the stale probe lets the empty
	/// pop cancel instead of covering the page with the exit confirmation
	/// (#2701).
	/// </summary>
	private static bool RootBackMayExitApp => !OperatingSystem.IsIOS() && !OperatingSystem.IsMacCatalyst();

	private void OnNavigated(object? sender, ShellNavigatedEventArgs e)
	{
		ApplyBackChrome();
		_navigationInFlight = false;
#if IOS || MACCATALYST
		GateIosInteractiveBack();
		// The pushed page's native controller can lag the Navigated event.
		Dispatcher.Dispatch(GateIosInteractiveBack);
#endif
		var analytics = Application.Current?.Handler?.MauiContext?.Services.GetService<IAnalyticsService>();
		if (analytics == null)
		{
			return;
		}
		// Logical screen names for GA (#2119): the route URI embeds Shell
		// container segments and query strings, and Firebase's automatic
		// tracking only saw MainActivity/renderer classes before it was
		// disabled in the manifests — the page's logical name replaces both.
		var name = AnalyticsScreens.ScreenNameFor(CurrentPage);
		if (name is not null)
		{
			analytics.SetScreen(name, name);
		}
	}

#if IOS || MACCATALYST
	/// <summary>
	/// UIKit keeps InteractivePopGestureRecognizer enabled at the navigation
	/// root even though nothing can pop, and screen-edge recognizers claim
	/// edge touches before the shared flyout pan — every root destination
	/// (calendar, Masora, Tanahpedia, ...) would lose the right-edge drawer
	/// swipe to a dead history gesture (#2432). Gate it on real history for
	/// every Shell page; the readers additionally wire carousel priority via
	/// <see cref="Helpers.ReaderPlatformChrome"/>.
	/// </summary>
	private void GateIosInteractiveBack()
	{
		if (CurrentPage is { } page &&
			(page.Handler as IPlatformViewHandler)?.ViewController?.NavigationController
				?.InteractivePopGestureRecognizer is { } back)
		{
			back.Enabled = page.Navigation.NavigationStack.Count > 1;
		}
	}
#endif

	/// <summary>
	/// Flyout navigation behind the shared failure boundary — a fault inside an
	/// <c>async void</c> tap handler otherwise rethrows unhandled on the main
	/// synchronization context.
	/// </summary>
	private static async Task GoToFlyoutAsync(string route)
	{
		try
		{
			await ShellAppNavigator.Instance.GoToAsync(route);
		}
		#pragma warning disable S2221 // Deliberate failure boundary: flyout navigation failure is log-only
		catch (Exception ex) //NOSONAR — flyout navigation failure is log-only.
		{
			#pragma warning restore S2221
			Console.Error.WriteLine($"Flyout navigation to {route} failed: {ex}");
		}
	}

	private async void OnAlHaperekTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToFlyoutAsync(AppRoutes.FlyoutPage("PerekPage", CurrentState.Location.OriginalString));
	}

	private async void OnTanahpediaTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToFlyoutAsync(AppRoutes.FlyoutPage("TanahpediaPage", CurrentState.Location.OriginalString));
	}

	private async void OnLearningCalendarTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToFlyoutAsync(AppRoutes.FlyoutPage(AppRoutes.LearningCalendar, CurrentState.Location.OriginalString));
	}

	private async void OnMasoraTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToFlyoutAsync(AppRoutes.FlyoutPage(AppRoutes.Masora, CurrentState.Location.OriginalString));
	}

	private async void OnParashaTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToFlyoutAsync(AppRoutes.FlyoutPage("ParashaListPage", CurrentState.Location.OriginalString));
	}

	private async void OnAuthorsTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToFlyoutAsync(AppRoutes.FlyoutPage("AuthorsPage", CurrentState.Location.OriginalString));
	}

	private async void OnTermsTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToFlyoutAsync(AppRoutes.FlyoutPage("TosPage", CurrentState.Location.OriginalString));
	}

	private async void OnPreferencesTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToFlyoutAsync(AppRoutes.FlyoutPage("PreferencesPage", CurrentState.Location.OriginalString));
	}

	private async void OnContactTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToFlyoutAsync(AppRoutes.FlyoutPage("ContactPage", CurrentState.Location.OriginalString));
	}

	private async void OnDonationsTapped(object? sender, TappedEventArgs e)
	{
		FlyoutIsPresented = false;
		await GoToFlyoutAsync(AppRoutes.FlyoutPage("DonationsPage", CurrentState.Location.OriginalString));
	}
}
