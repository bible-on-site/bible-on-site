using BibleOnSite.Helpers;
using BibleOnSite.Pages;
using BibleOnSite.Services;

namespace BibleOnSite;

#pragma warning disable S2333 // The Shell is shared with its XAML and other code-behind partial.
public partial class AppShell
#pragma warning restore S2333
{
    private bool _homeUxLinksSubscribed;
    private bool _homeUxLinkNavigationPending;

    private void ConfigureHomeUxLinks()
    {
        SubscribeHomeUxLinks();
        Loaded += (_, _) => SubscribeHomeUxLinks();
        Unloaded += (_, _) =>
        {
            AppLinkHelper.TargetRequested -= OnHomeUxAppLinkRequested;
            _homeUxLinksSubscribed = false;
        };
    }

    private void SubscribeHomeUxLinks()
    {
        if (_homeUxLinksSubscribed) { return; }
        AppLinkHelper.TargetRequested += OnHomeUxAppLinkRequested;
        _homeUxLinksSubscribed = true;
    }

    #pragma warning disable S1172 // The app-link EventHandler requires its sender argument.
    private async void OnHomeUxAppLinkRequested(object? sender, AppLinkHelper.AppLinkTarget target)
    #pragma warning restore S1172
    {
        if (AppLinkHelper.PendingTarget == target)
        {
            await OpenHomeUxAppLinkAsync();
        }
    }

    internal async Task OpenHomeUxAppLinkAsync()
    {
        // The regular reader already owns links while it is in the stack.
        // The home shell covers calendar/search/settings before a reader exists.
        if (_homeUxLinkNavigationPending || ReaderContent.Content is LoadingPage ||
            !ReferenceEquals(Shell.Current, this) || AppLinkHelper.PendingTarget is null ||
            Navigation.NavigationStack.OfType<PerekPage>().Any())
        {
            return;
        }
        _homeUxLinkNavigationPending = true;
        try
        {
            await ShellAppNavigator.Instance.GoToQueuedAsync(AppRoutes.CalendarReader);
        }
        #pragma warning disable S2221 // UI failure boundary: preserve the pending link when navigation is temporarily unavailable.
        catch (Exception ex) //NOSONAR - keep the target available for the next home appearance.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Home] Pending app link could not open: {ex}");
        }
        finally { _homeUxLinkNavigationPending = false; }
    }
}
