using Microsoft.Extensions.Logging;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using BibleOnSite.Controls;
using BibleOnSite.Handlers;

// Force rebuild for font resource loading
namespace BibleOnSite;

public static class MauiProgram
{
	public static MauiApp CreateMauiApp()
	{
		var builder = MauiApp.CreateBuilder();
		builder
			.UseMauiApp<App>()
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

		// Initialize PreferencesService with MAUI storage
		PreferencesService.Initialize(new MauiPreferencesStorage());

		// Register services
		builder.Services.AddSingleton(_ => PreferencesService.Instance);
		builder.Services.AddSingleton(_ => StarterService.Instance);

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
