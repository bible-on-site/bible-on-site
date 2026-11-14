using BibleOnSite.Services;
using FluentAssertions;
using Microsoft.Maui;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Dispatching;
using Moq;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// Regression: picking a hamburger-menu item used to swap the Shell root ("//AuthorsPage"),
/// leaving the menu page with no back stack and no way back to the perek page.
/// </summary>
[Collection("Application state")]
public class FlyoutNavigationTests
{
    private sealed class TestApplication(Page page) : Application
    {
        protected override Window CreateWindow(IActivationState? activationState)
        {
            _ = activationState;
            return new Window(page);
        }
    }

    private sealed class AuthorsStub : ContentPage;
    private sealed class TosStub : ContentPage;
    private sealed class SearchReaderStub : ContentPage;

    private static async Task<Shell> WithShellAsync(Func<Shell, Task> body)
    {
        var previous = Application.Current;
        var dispatcher = new Mock<IDispatcher>();
        dispatcher.SetupGet(d => d.IsDispatchRequired).Returns(false);
        dispatcher.Setup(d => d.Dispatch(It.IsAny<Action>())).Returns((Action action) => { action(); return true; });
        var provider = new Mock<IDispatcherProvider>();
        provider.Setup(p => p.GetForCurrentThread()).Returns(dispatcher.Object);
        DispatcherProvider.SetCurrent(provider.Object);
        try
        {
            Routing.RegisterRoute("FlyoutTestAuthors", typeof(AuthorsStub));
            Routing.RegisterRoute("FlyoutTestTos", typeof(TosStub));
            Routing.RegisterRoute(AppRoutes.SearchReader, typeof(SearchReaderStub));
            var shell = new Shell();
            shell.Items.Add(new ShellContent { Route = AppRoutes.Perek, Content = new ContentPage() });
            var application = new TestApplication(shell);
            Application.Current = application;
            ((IApplication)application).CreateWindow(null!);
            await shell.GoToAsync($"//{AppRoutes.Perek}");
            await body(shell);
            return shell;
        }
        finally
        {
            Routing.UnRegisterRoute("FlyoutTestAuthors");
            Routing.UnRegisterRoute("FlyoutTestTos");
            Routing.UnRegisterRoute(AppRoutes.SearchReader);
            Application.Current = previous;
            DispatcherProvider.SetCurrent(null);
        }
    }

    [Fact]
    public async Task FlyoutPage_IsPushedAbovePerek_AndBackReturnsToPerek()
    {
        await WithShellAsync(async shell =>
        {
            await shell.GoToAsync(AppRoutes.FlyoutPage("FlyoutTestAuthors"));

            shell.Navigation.NavigationStack.Should().HaveCount(2);
            shell.CurrentPage.Should().BeOfType<AuthorsStub>();

            await shell.GoToAsync("..");

            shell.Navigation.NavigationStack.Should().HaveCount(1);
            shell.CurrentState.Location.OriginalString.Should().Be($"//{AppRoutes.Perek}");
        });
    }

    [Fact]
    public async Task FlyoutPage_FromAnotherFlyoutPage_ReplacesItInsteadOfStacking()
    {
        await WithShellAsync(async shell =>
        {
            await shell.GoToAsync(AppRoutes.FlyoutPage("FlyoutTestAuthors"));
            await shell.GoToAsync(AppRoutes.FlyoutPage("FlyoutTestTos"));

            shell.Navigation.NavigationStack.Should().HaveCount(2);
            shell.CurrentPage.Should().BeOfType<TosStub>();
        });
    }

    [Fact]
    public async Task FlyoutPage_ForPerek_PopsBackToPerek()
    {
        await WithShellAsync(async shell =>
        {
            await shell.GoToAsync(AppRoutes.FlyoutPage("FlyoutTestAuthors"));
            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.Perek));

            shell.Navigation.NavigationStack.Should().HaveCount(1);
            shell.CurrentState.Location.OriginalString.Should().Be($"//{AppRoutes.Perek}");
        });
    }

    [Fact]
    public async Task FlyoutPage_AfterSearchJump_PreservesBothReaderAndSearchHistory()
    {
        await WithShellAsync(async shell =>
        {
            var original = shell.CurrentPage;
            await shell.GoToAsync(AppRoutes.SearchReader);
            var reader = shell.CurrentPage;
            await shell.GoToAsync(AppRoutes.FlyoutPage("FlyoutTestAuthors", shell.CurrentState.Location.OriginalString));
            await shell.GoToAsync(AppRoutes.FlyoutPage("FlyoutTestTos", shell.CurrentState.Location.OriginalString));
            shell.Navigation.NavigationStack.Should().HaveCount(3);
            shell.CurrentPage.Should().BeOfType<TosStub>();
            await shell.GoToAsync("..");
            shell.CurrentPage.Should().BeSameAs(reader);
            await shell.GoToAsync("..");
            shell.CurrentPage.Should().BeSameAs(original);
        });
    }

    [Theory]
    [InlineData("//PerekPage/searchReader/searchReader/PreferencesPage?source=x", "//PerekPage/searchReader/searchReader")]
    [InlineData("//unknown/PreferencesPage", "//PerekPage")]
    public void FlyoutPage_ForReader_PreservesTheLatestReaderPath(string location, string expected)
    {
        AppRoutes.FlyoutPage(AppRoutes.Perek, location).Should().Be(expected);
    }
}
