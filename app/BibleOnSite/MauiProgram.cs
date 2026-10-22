using Microsoft.Extensions.Logging;
using CommunityToolkit.Maui;
using Microsoft.Maui.LifecycleEvents;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using BibleOnSite.Controls;
using BibleOnSite.Handlers;
#if IOS && !DISABLE_ANALYTICS
using Plugin.Firebase.Core.Platforms.iOS;
using Plugin.Firebase.Analytics;
#endif

// Force rebuild for font resource loading
namespace BibleOnSite;

public static class MauiProgram
{
    /// <summary>
    /// Indicates whether Firebase was successfully initialized on iOS.
    /// Always false on non-iOS platforms (Android auto-inits, others don't use Firebase).
    /// When false on iOS, analytics calls are skipped to avoid repeated exceptions.
    /// </summary>
    internal static bool IsFirebaseInitialized { get; private set; }

    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();
#pragma warning disable CA1416 // MediaElement requires Android 26+; harmless on older devices
        builder
            .UseMauiApp<App>()
            .UseMauiCommunityToolkit()
            .UseMauiCommunityToolkitMediaElement(false)
#pragma warning restore CA1416
            .ConfigureFonts(fonts =>
            {
                fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular");
                fonts.AddFont("OpenSans-Semibold.ttf", "OpenSansSemibold");
                fonts.AddFont("FluentSystemIcons-Regular.ttf", "FluentIcons");
            })
            .ConfigureMauiHandlers(handlers =>
            {
                handlers.AddHandler<HtmlView, HtmlViewHandler>();
                handlers.AddHandler<PasukTextLabel, PasukTextLabelHandler>();
#if IOS || MACCATALYST
                handlers.AddHandler<ReaderCellBorder, ReaderCellBorderHandler>();
				// Keep the Items2 handlers (.NET 10 default) but pin every native
				// cell's managed peer: Items2 cells are only weakly anchored, and a
				// covered page's retained cells crash the app with MissingCtor when
				// a later layout pass marshals them back (#2433).
				handlers.AddHandler<CollectionView, RetainedCellCollectionViewHandler>();
				handlers.AddHandler<CarouselView, RetainedCellCarouselViewHandler>();
#endif
            });

#if ANDROID
        // Increase CarouselView's internal RecyclerView cache so pre-rendered views
        // aren't evicted after ~2 swipes. This eliminates the ~250ms lag when visiting
        // a perek for the first time.
        Microsoft.Maui.Controls.Handlers.Items.CarouselViewHandler.Mapper.AppendToMapping("LargerViewCache", (handler, _) =>
        {
            if (handler.PlatformView is AndroidX.RecyclerView.Widget.RecyclerView recyclerView)
            {
                // Keep up to 10 off-screen views in cache (default is ~2)
                recyclerView.SetItemViewCacheSize(10);
                // Also increase the recycled view pool so evicted views are reused faster
                recyclerView.GetRecycledViewPool()?.SetMaxRecycledViews(0, 10);
            }
        });

#endif

#if IOS || MACCATALYST
		// Lock the CarouselView's scroll direction so that a primarily vertical gesture
		// (scrolling through pasukim) doesn't accidentally trigger a horizontal perek
		// switch. Once iOS determines the dominant scroll axis, movement on the other
		// axis is suppressed for that gesture — matching the legacy Flutter app's
		// PageView + ListView gesture-arena behavior.
		Microsoft.Maui.Controls.Handlers.Items2.CarouselViewHandler2.Mapper.AppendToMapping("SwipeSensitivity", (handler, _) =>
		{
			var collectionView = FindDescendant<UIKit.UICollectionView>(handler.PlatformView);
			Helpers.DebugLog.Write($"[EdgePan] carousel mapper platformView={handler.PlatformView?.GetType().Name ?? "null"} collectionView={collectionView?.GetType().Name ?? "null"}");
			if (collectionView is null)
			{
				return;
			}
			collectionView.DirectionalLockEnabled = true;
			// The carousel's horizontal paging pan competes with the Shell
			// flyout's right-edge recognizer over the same touches and usually
			// wins, leaving the RTL drawer gesture dead on perek pages (#1306).
			// Give the drawer gesture priority so a swipe starting at the
			// right screen edge opens the drawer instead of switching perek.
			collectionView.PanGestureRecognizer.RequireGestureRecognizerToFail(AppShell.SharedFlyoutEdgePan);
			Helpers.DebugLog.Write("[EdgePan] carousel pan wired");
		});
#endif

        // Initialize Firebase on iOS from GoogleService-Info.plist (the iOS equivalent of google-services.json).
        // Android auto-inits from google-services.json at build time, but iOS requires an explicit init call.
        // Without this, CrossFirebaseAnalytics.Current silently fails on iOS.
        // Note: Plugin.Firebase 4.0.0 does NOT support MacCatalyst — only iOS and Android.
        //
        // #2120: DISABLE_ANALYTICS builds (Debug/e2e) skip Firebase entirely —
        // with no init call the SDK never configures, so no automatic or manual
        // event can be emitted, queued or flushed on iOS.
        // If initialization raises a managed exception, leave analytics disabled.
        // Native crashes require a device crash report and cannot be caught here.
        builder.ConfigureLifecycleEvents(events =>
        {
#if IOS || MACCATALYST
            // Managed asset-pack downloads resume in the background; the download
            // delegate must be installed before the system replays their callbacks.
            events.AddiOS(iOS => iOS.WillFinishLaunching((_, __) =>
            {
                PadDeliveryService.ConfigureBackgroundAssets();
                return true;
            }));
#endif
#if IOS && !DISABLE_ANALYTICS
			events.AddiOS(iOS => iOS.WillFinishLaunching((_, __) =>
			{
				try
				{
					CrossFirebase.Initialize();
					IsFirebaseInitialized = true;
					// Info.plist keeps collection off so nothing can emit before
					// this point; collection then enables only for a stored
					// user opt-in (#2400), never in e2e-marked processes so
					// automatic and custom suite events never reach the
					// production property, and the explicit value also
					// overrides a flag a previous non-suite install persisted
					// on this device.
					var analyticsCollectionEnabled =
						AnalyticsConsent.IsCollectionEnabled(new MauiPreferencesStorage());
					CrossFirebaseAnalytics.Current.IsAnalyticsCollectionEnabled = analyticsCollectionEnabled;
					Console.WriteLine($"[Analytics] collection enabled={analyticsCollectionEnabled}");
				}
				catch (Exception ex)
				{
					System.Diagnostics.Debug.WriteLine($"[Firebase] Initialization failed (analytics disabled): {ex.Message}");
					Console.Error.WriteLine($"[Firebase] Initialization failed (analytics disabled): {ex.Message}");
				}
				return false;
			}));
#endif
        });

        // Initialize PreferencesService with MAUI storage
        PreferencesService.Initialize(new MauiPreferencesStorage());

        // Register services
        builder.Services.AddSingleton<IPadDeliveryService>(_ => PadDeliveryService.Instance);
        builder.Services.AddSingleton(_ => PreferencesService.Instance);
        builder.Services.AddSingleton(_ => StarterService.Instance);
        builder.Services.AddSingleton<IAnalyticsService, AnalyticsService>();

        // Register ViewModels
        builder.Services.AddTransient<PerekViewModel>();
        builder.Services.AddTransient<PreferencesViewModel>();

        // Register Pages
        builder.Services.AddTransient<MainPage>();

#if DEBUG
        builder.Logging.AddDebug();
#endif

        return builder.Build();
    }

#if IOS || MACCATALYST
	private static T? FindDescendant<T>(UIKit.UIView? root) where T : UIKit.UIView
	{
		if (root is T match)
		{
			return match;
		}
		foreach (var child in root?.Subviews ?? [])
		{
			var found = FindDescendant<T>(child);
			if (found is not null)
			{
				return found;
			}
		}
		return null;
	}
#endif
}
