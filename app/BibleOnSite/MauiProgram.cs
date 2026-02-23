using Microsoft.Extensions.Logging;
using CommunityToolkit.Maui;
using Microsoft.Maui.LifecycleEvents;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using BibleOnSite.Controls;
using BibleOnSite.Handlers;
#if IOS
using Plugin.Firebase.Core.Platforms.iOS;
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
		builder
			.UseMauiApp<App>()
			.UseMauiCommunityToolkit()
			.ConfigureFonts(fonts =>
			{
				fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular");
				fonts.AddFont("OpenSans-Semibold.ttf", "OpenSansSemibold");
				fonts.AddFont("FluentSystemIcons-Regular.ttf", "FluentIcons");
			})
			.ConfigureMauiHandlers(handlers =>
			{
				handlers.AddHandler<HtmlView, HtmlViewHandler>();
#if IOS || MACCATALYST
				// Use optimized CollectionView handler for iOS/Mac (default in .NET 10)
				handlers.AddHandler<CollectionView, Microsoft.Maui.Controls.Handlers.Items2.CollectionViewHandler2>();
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

		// Prevent the outer CarouselView from intercepting primarily-vertical gestures.
		// Each inner CollectionView (pasukim list) claims the gesture on ACTION_DOWN
		// and only releases it when horizontal movement clearly dominates — the same
		// pattern Flutter's gesture arena uses in the legacy app.
		Microsoft.Maui.Controls.Handlers.Items.CollectionViewHandler.Mapper.AppendToMapping("SwipeSensitivity", (handler, _) =>
		{
			if (handler.PlatformView is AndroidX.RecyclerView.Widget.RecyclerView recyclerView)
			{
				recyclerView.AddOnItemTouchListener(
					new BibleOnSite.Platforms.Android.Listeners.VerticalScrollPriorityListener());
			}
		});
#endif

#if IOS || MACCATALYST
		// Lock the CarouselView's scroll direction so that a primarily vertical gesture
		// (scrolling through pasukim) doesn't accidentally trigger a horizontal perek
		// switch. Once iOS determines the dominant scroll axis, movement on the other
		// axis is suppressed for that gesture — matching the legacy Flutter app's
		// PageView + ListView gesture-arena behavior.
		Microsoft.Maui.Controls.Handlers.Items.CarouselViewHandler.Mapper.AppendToMapping("SwipeSensitivity", (handler, _) =>
		{
			if (handler.PlatformView is UIKit.UICollectionView collectionView)
			{
				collectionView.DirectionalLockEnabled = true;
			}
		});
#endif

		// Initialize Firebase on iOS from GoogleService-Info.plist (the iOS equivalent of google-services.json).
		// Android auto-inits from google-services.json at build time, but iOS requires an explicit init call.
		// Without this, CrossFirebaseAnalytics.Current silently fails on iOS.
		// Note: Plugin.Firebase 4.0.0 does NOT support MacCatalyst — only iOS and Android.
		//
		// Wrapped in try-catch because the underlying Firebase iOS SDK (currently 12.5 via AdamE bindings)
		// crashes on iOS 26 due to a known issue (firebase/firebase-ios-sdk#15020, fixed in SDK 12.9.0).
		// Until the .NET bindings are updated, we gracefully degrade: the app works without analytics.
		builder.ConfigureLifecycleEvents(events =>
		{
#if IOS
			events.AddiOS(iOS => iOS.WillFinishLaunching((_, __) =>
			{
				try
				{
					CrossFirebase.Initialize();
					IsFirebaseInitialized = true;
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
}
