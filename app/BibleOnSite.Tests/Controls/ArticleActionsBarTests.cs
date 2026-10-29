using System.Windows.Input;
using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using FluentAssertions;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Controls.Shapes;
using Microsoft.Maui.Graphics;
using Moq;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// The unified article command group (#2786): Share and Fullscreen live in
/// one pill mirroring the navigation capsule, so these tests pin the shared
/// geometry, glyph/accessible-name contract, command forwarding and the
/// fullscreen request the page's <see cref="ArticleChrome"/> consumes.
/// </summary>
public class ArticleActionsBarTests
{
    private sealed class AppResources : IDisposable
    {
        private readonly Application? _previous;

        public AppResources()
        {
            _previous = Application.Current;
            Application.Current = new Application
            {
                Resources = new ResourceDictionary
                {
                    ["Primary"] = Colors.Blue,
                },
            };
        }

        public void Dispose() => Application.Current = _previous;
    }

    [Fact]
    public void ActionsBar_MirrorsTheCapsulePillChrome()
    {
        using var _ = new AppResources();
        var bar = new ArticleActionsBar();

        bar.HeightRequest.Should().Be(SharedTopBar.PillHeight);
        bar.Padding.Should().Be(new Thickness(2, 0));
        bar.Margin.Should().Be(new Thickness(4, 0));
        bar.VerticalOptions.Should().Be(LayoutOptions.Center);
        bar.StrokeShape.Should().BeOfType<RoundRectangle>()
            .Which.CornerRadius.Should().Be(new CornerRadius(SharedTopBar.PillCornerRadius),
                "the actions group reuses the capsule/title-pill corner radius");
        bar.BackgroundColor.Should().Be(ToolbarPill.LightColor,
            "the command pill rides the same pill surface as the navigation capsule");
    }

    [Fact]
    public void ActionsBar_KeepsShareInwardAndFullscreenAtTheEdge()
    {
        using var _ = new AppResources();
        var bar = new ArticleActionsBar();

        var row = bar.Content.Should().BeOfType<HorizontalStackLayout>().Subject;
        row.Children[0].Should().BeSameAs(bar.ShareButton,
            "Share sits adjacent to the title pill inside the group");
        row.Children[1].Should().BeSameAs(bar.FullScreenButton,
            "Fullscreen owns the extreme trailing edge — the reader's trailing command");
    }

    [Fact]
    public void ActionsBar_Buttons_AreRecognizableLocalizedCommands()
    {
        using var _ = new AppResources();
        var bar = new ArticleActionsBar();

        bar.ShareButton.Text.Should().Be(Fonts.FluentUI.share_android_24_regular);
        bar.FullScreenButton.Text.Should().Be(Fonts.FluentUI.full_screen_maximize_24_regular);
        foreach (var button in new[] { bar.ShareButton, bar.FullScreenButton })
        {
            button.FontFamily.Should().Be("FluentIcons");
            button.WidthRequest.Should().Be(44, "every command keeps the accessible touch target");
            button.BackgroundColor.Should().Be(Colors.Transparent);
        }

        SemanticProperties.GetDescription(bar.ShareButton).Should().Be("שתף");
        SemanticProperties.GetDescription(bar.FullScreenButton).Should().Be("מסך מלא");
        bar.ShareButton.AutomationId.Should().Be("ArticleShareButton");
        bar.FullScreenButton.AutomationId.Should().Be("ArticleFullScreenButton");
    }

    [Fact]
    public void ShareCommand_ForwardsToTheShareButton()
    {
        using var _ = new AppResources();
        var bar = new ArticleActionsBar();
        var command = new Mock<ICommand>().Object;

        bar.ShareCommand = command;

        bar.ShareButton.Command.Should().BeSameAs(command,
            "the page binds one ShareCommand and the pill routes it to the button");
    }

    [Fact]
    public void ShareButton_ExecutesTheBoundCommand()
    {
        using var _ = new AppResources();
        var bar = new ArticleActionsBar();
        var executions = 0;
        bar.ShareCommand = new Command(() => executions++);

        bar.ShareButton.SendClicked();

        executions.Should().Be(1);
    }

    [Fact]
    public void FullScreenButton_RaisesTheSurfaceEvent_Once()
    {
        using var _ = new AppResources();
        var bar = new ArticleActionsBar();
        var requests = 0;
        ((IArticleActionsSurface)bar).FullScreenRequested += (_, _) => requests++;

        bar.FullScreenButton.SendClicked();

        requests.Should().Be(1, "the coordinator, not the button, owns the transition");
    }
}
