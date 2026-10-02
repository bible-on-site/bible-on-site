using BibleOnSite.Services;
using Microsoft.Maui;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Controls.Internals;
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
            await ShellAppNavigator.Instance.DisplayAlertAsync("title", "message", "cancel").WaitAsync(TimeSpan.FromSeconds(2));
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
}
