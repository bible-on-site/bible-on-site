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
#endif

		// Initialize Firebase on iOS from GoogleService-Info.plist (the iOS equivalent of google-services.json).
		// Android auto-inits from google-services.json at build time, but iOS requires an explicit init call.
		// Without this, CrossFirebaseAnalytics.Current silently fails on iOS.
		// Note: Plugin.Firebase 4.0.0 does NOT support MacCatalyst — only iOS and Android.
		builder.ConfigureLifecycleEvents(events =>
		{
#if IOS
			events.AddiOS(iOS => iOS.WillFinishLaunching((_, __) =>
			{
				CrossFirebase.Initialize();
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
