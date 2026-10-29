using BibleOnSite.Services;
using Microsoft.Maui;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Controls.Internals;
using Microsoft.Maui.Dispatching;
using Microsoft.Extensions.DependencyInjection;

namespace BibleOnSite.Tests.Services;

[Collection("Application state")]
public class NavigationBoundaryTests
{
    private sealed class TestApplication(Page? page) : Application
    {
        protected override Window CreateWindow(IActivationState? activationState)
        {
            // MAUI requires this override parameter; the fixture owns its window.
            _ = activationState;
            return page == null ? new Window() : new Window(page);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Alert_BeforeWindowOrPageCreation_CompletesWithoutNativeDialog(bool createWindow)
    {
        var previous = Application.Current;
        try
        {
            var application = new TestApplication(null);
            Application.Current = application;
            if (createWindow)
            {
                ((IApplication)application).CreateWindow(null!);
            }
            await ShellAppNavigator.Instance.DisplayAlertAsync("title", "message", "cancel");
            application.Windows.Should().HaveCount(createWindow ? 1 : 0);
        }
        finally
        {
            Application.Current = previous;
        }
    }

    [Fact]
    public async Task Choice_BeforeWindowOrPageCreation_ReturnsFalse_NeverAFalseAccept()
    {
        var previous = Application.Current;
        try
        {
            var application = new TestApplication(null);
            Application.Current = application;
            ((IApplication)application).CreateWindow(null!);
            (await ShellAppNavigator.Instance.DisplayChoiceAsync("title", "message", "accept", "cancel"))
                .Should().BeFalse("a dialog that cannot appear must never report acceptance");
        }
        finally
        {
            Application.Current = previous;
        }
    }

    [Fact]
    public async Task Choice_ForwardsArgumentsAndResultToTheWindowDialogService()
    {
        var previous = Application.Current;
        try
        {
            var page = new ContentPage();
            var application = new TestApplication(page);
            Application.Current = application;
            var window = ((IApplication)application).CreateWindow(null!);
            AlertArguments? request = null;
            using var services = new ServiceCollection()
                .AddKeyedSingleton<Func<Page, AlertArguments, Task<bool>>>("Microsoft.Maui.Controls.DisplayAlert", (_, _) =>
                    (_, arguments) =>
                    {
                        request = arguments;
                        return Task.FromResult(true);
                    })
                .BuildServiceProvider();
            var context = new Mock<IMauiContext>();
            context.SetupGet(c => c.Services).Returns(services);
            var windowHandler = new Mock<IElementHandler>();
            windowHandler.SetupGet(h => h.MauiContext).Returns(context.Object);
            window.Handler = windowHandler.Object;
            var pageHandler = new Mock<IViewHandler>();
            pageHandler.SetupGet(h => h.MauiContext).Returns(context.Object);
            page.Handler = pageHandler.Object;
            (await ShellAppNavigator.Instance.DisplayChoiceAsync("title", "message", "accept", "cancel")
                .WaitAsync(TimeSpan.FromSeconds(2), TestContext.Current.CancellationToken)).Should().BeTrue();
            request.Should().NotBeNull();
            request!.Title.Should().Be("title");
            request.Message.Should().Be("message");
            request.Accept.Should().Be("accept");
            request.Cancel.Should().Be("cancel");
        }
        finally
        {
            Application.Current = previous;
        }
    }

    [Fact]
    public async Task Navigation_ForwardsTheRouteToShell_AndPreservesInvalidRouteError()
    {
        var previous = Application.Current;
        try
        {
            var shell = new Shell();
            shell.Items.Add(new ShellContent { Route = "home", Content = new ContentPage() });
            var application = new TestApplication(shell);
            Application.Current = application;
            ((IApplication)application).CreateWindow(null!);
            await ShellAppNavigator.Instance.GoToAsync("//home");
            shell.CurrentState.Location.OriginalString.Should().Contain("home");
            await FluentActions.Awaiting(() => ShellAppNavigator.Instance.GoToAsync("missingRoute"))
                .Should().ThrowAsync<ArgumentException>().WithMessage("*missingRoute*");
        }
        finally
        {
            Application.Current = previous;
        }
    }

    [Fact]
    public async Task Alert_ForwardsArgumentsToTheWindowDialogService()
    {
        var previous = Application.Current;
        try
        {
            var page = new ContentPage();
            var application = new TestApplication(page);
            Application.Current = application;
            var window = ((IApplication)application).CreateWindow(null!);
            Page? sender = null;
            AlertArguments? request = null;
            using var services = new ServiceCollection()
                .AddKeyedSingleton<Func<Page, AlertArguments, Task<bool>>>("Microsoft.Maui.Controls.DisplayAlert", (_, _) =>
                    (target, arguments) =>
                    {
                        sender = target;
                        request = arguments;
                        return Task.FromResult(false);
                    })
                .BuildServiceProvider();
            var context = new Mock<IMauiContext>();
            context.SetupGet(c => c.Services).Returns(services);
            var windowHandler = new Mock<IElementHandler>();
            windowHandler.SetupGet(h => h.MauiContext).Returns(context.Object);
            window.Handler = windowHandler.Object;
            var pageHandler = new Mock<IViewHandler>();
            pageHandler.SetupGet(h => h.MauiContext).Returns(context.Object);
            page.Handler = pageHandler.Object;
            await ShellAppNavigator.Instance.DisplayAlertAsync("title", "message", "cancel").WaitAsync(TimeSpan.FromSeconds(2), TestContext.Current.CancellationToken);
            sender.Should().BeSameAs(page);
            request.Should().NotBeNull();
            request!.Title.Should().Be("title");
            request.Message.Should().Be("message");
            request.Cancel.Should().Be("cancel");
        }
        finally
        {
            Application.Current = previous;
        }
    }
    [Fact]
    public async Task Navigation_ParameterizedAndQueuedRoutes_ReachShell()
    {
        var previous = Application.Current;
        try
        {
            var shell = new Shell();
            shell.Items.Add(new ShellContent { Route = "home", Content = new ContentPage() });
            var application = new TestApplication(shell);
            Application.Current = application;
            ((IApplication)application).CreateWindow(null!);

            await ShellAppNavigator.Instance.GoToAsync("//home", false,
                new Dictionary<string, object> { ["section"] = "packs" });
            await ShellAppNavigator.Instance.GoToQueuedAsync("//home");

            shell.CurrentState.Location.OriginalString.Should().Contain("home");
        }
        finally
        {
            Application.Current = previous;
        }
    }

    public sealed class ContextualPreferencesPage : ContentPage, IQueryAttributable
    {
        public string? Section { get; private set; }
        public void ApplyQueryAttributes(IDictionary<string, object> query) =>
            Section = query.TryGetValue("section", out var section) ? section as string : null;
    }

    [Theory]
    [InlineData("reader")]
    [InlineData("searchReader")]
    [InlineData("ParashaPage")]
    [InlineData("MasoraPage")]
    public async Task PerushimPreferences_SystemBackWithHiddenInAppButton_ReturnsToTheSameReader(string readerRoute)
    {
        var previous = Application.Current;
        var dispatcher = new Mock<IDispatcher>();
        dispatcher.SetupGet(d => d.IsDispatchRequired).Returns(false);
        dispatcher.Setup(d => d.Dispatch(It.IsAny<Action>())).Returns((Action action) => { action(); return true; });
        var provider = new Mock<IDispatcherProvider>();
        provider.Setup(p => p.GetForCurrentThread()).Returns(dispatcher.Object);
        DispatcherProvider.SetCurrent(provider.Object);
        Routing.RegisterRoute("PreferencesPage", typeof(ContextualPreferencesPage));
        try
        {
            var reader = new ContentPage();
            var shell = new Shell();
            shell.Items.Add(new ShellContent { Route = readerRoute, Content = reader });
            var application = new TestApplication(shell);
            Application.Current = application;
            var window = ((IApplication)application).CreateWindow(null!);
            await shell.GoToAsync($"//{readerRoute}");

            await PreferencesNavigation.OpenPerushimDownloadAsync(ShellAppNavigator.Instance);

            var preferences = shell.CurrentPage.Should().BeOfType<ContextualPreferencesPage>().Subject;
            preferences.Section.Should().Be("packs");
            shell.Navigation.NavigationStack.Should().HaveCount(2,
                "the contextual shortcut adds one preferences entry above its caller");
            Shell.SetBackButtonBehavior(preferences, new BackButtonBehavior { IsVisible = false });

            ((IWindow)window).BackButtonClicked().Should().BeTrue();
            await Task.Yield();

            shell.CurrentPage.Should().BeSameAs(reader);
            shell.Navigation.NavigationStack.Should().ContainSingle();
        }
        finally
        {
            Routing.UnRegisterRoute("PreferencesPage");
            DispatcherProvider.SetCurrent(null);
            Application.Current = previous;
        }
    }

    [Fact]
    public async Task PreferencesChromeBack_PopsItsSingleHistoryEntry()
    {
        // The capsule Back in the preferences template rides the shared
        // pipeline (IWindow.BackButtonClicked) — one pop per press (#2467).
        var previous = Application.Current;
        var dispatcher = new Mock<IDispatcher>();
        dispatcher.SetupGet(d => d.IsDispatchRequired).Returns(false);
        dispatcher.Setup(d => d.Dispatch(It.IsAny<Action>())).Returns((Action action) => { action(); return true; });
        var provider = new Mock<IDispatcherProvider>();
        provider.Setup(p => p.GetForCurrentThread()).Returns(dispatcher.Object);
        DispatcherProvider.SetCurrent(provider.Object);
        Routing.RegisterRoute("PreferencesPage", typeof(ContextualPreferencesPage));
        try
        {
            var reader = new ContentPage();
            var shell = new Shell();
            shell.Items.Add(new ShellContent { Route = "reader", Content = reader });
            var application = new TestApplication(shell);
            Application.Current = application;
            var window = ((IApplication)application).CreateWindow(null!);
            await shell.GoToAsync("//reader");
            await PreferencesNavigation.OpenPerushimDownloadAsync(ShellAppNavigator.Instance);

            ((IWindow)window).BackButtonClicked().Should().BeTrue();
            await Task.Yield();

            shell.CurrentPage.Should().BeSameAs(reader);
        }
        finally
        {
            Routing.UnRegisterRoute("PreferencesPage");
            DispatcherProvider.SetCurrent(null);
            Application.Current = previous;
        }
    }
}
