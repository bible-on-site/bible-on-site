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
			Console.WriteLine($"[EdgePan] carousel mapper platformView={handler.PlatformView?.GetType().Name ?? "null"} collectionView={collectionView?.GetType().Name ?? "null"}");
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
			Console.WriteLine("[EdgePan] carousel pan wired");
		});
#endif

		// Initialize Firebase on iOS from GoogleService-Info.plist (the iOS equivalent of google-services.json).
		// Android auto-inits from google-services.json at build time, but iOS requires an explicit init call.
		// Without this, CrossFirebaseAnalytics.Current silently fails on iOS.
		// Note: Plugin.Firebase 4.0.0 does NOT support MacCatalyst — only iOS and Android.
		//
		// If initialization raises a managed exception, leave analytics disabled.
		// Native crashes require a device crash report and cannot be caught here.
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
