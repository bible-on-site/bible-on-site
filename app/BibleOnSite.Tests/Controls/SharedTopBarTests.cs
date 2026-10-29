using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Services;
using FluentAssertions;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// Toolbar parity guard for #2061 and the #2467 navigation-capsule contract:
/// every page builds its chrome from <see cref="SharedTopBar"/>, so these
/// tests pin the shared geometry, the hamburger/Back capsule order and the
/// disabled-at-root Back state instead of per-page margins.
/// </summary>
public class SharedTopBarTests : IDisposable
{
    public SharedTopBarTests()
    {
        PreferencesService.Initialize(new InMemoryPreferencesStorage());
    }

    public void Dispose()
    {
        PreferencesService.ResetForTesting();
    }

    [Fact]
    public void SharedTopBar_HasReaderBandGeometry()
    {
        var bar = new SharedTopBar();

        var container = bar.Content.Should().BeOfType<Grid>().Subject;
        container.MinimumHeightRequest.Should().Be(56);

        var band = container.Children.OfType<Grid>().Single();
        band.HeightRequest.Should().Be(56);
        band.ColumnDefinitions.Select(column => column.Width.GridUnitType)
            .Should().Equal(new[] { GridUnitType.Auto, GridUnitType.Star, GridUnitType.Auto },
                "both edge groups size to content so their widths stay stable");
        var trailingHost = band.Children.OfType<ContentView>().Single(c => Grid.GetColumn(c) == 2);
        trailingHost.MinimumWidthRequest.Should().Be(SharedTopBar.EdgeWidth,
            "an empty trailing slot still reserves the 48px edge — a wider command pill grows past it");

        var separator = container.Children.OfType<BoxView>().Single();
        separator.HeightRequest.Should().Be(1);
        separator.VerticalOptions.Should().Be(LayoutOptions.End);
    }

    [Fact]
    public void SharedTopBar_HamburgerMatchesReaderButton()
    {
        var bar = new SharedTopBar();

        bar.NavigationButton.Text.Should().Be(Fonts.FluentUI.navigation_24_regular);
        bar.NavigationButton.FontFamily.Should().Be("FluentIcons");
        bar.NavigationButton.FontSize.Should().Be(24);
        bar.NavigationButton.BackgroundColor.Should().Be(Colors.Transparent);
        SemanticProperties.GetDescription(bar.NavigationButton)
            .Should().Be("פתיחת תפריט הניווט");
    }

    [Fact]
    public void SharedTopBar_Capsule_KeepsHamburgerFirstAndBackSecond()
    {
        // The contract (#2467): in the app's RTL band the hamburger is the
        // far-right control and Back is its immediate neighbour toward the
        // center — in flow order hamburger first, Back second, inside one pill.
        var bar = new SharedTopBar { ShowBack = true };

        var capsule = bar.NavCapsule;
        capsule.Children[0].Should().BeSameAs(bar.NavigationButton,
            "the hamburger owns the start edge so it stays the far-right control in RTL");
        capsule.Children[1].Should().BeSameAs(bar.BackButton,
            "Back is immediately beside the hamburger inside the same capsule");
        capsule.Should().BeOfType<HorizontalStackLayout>();
        capsule.Parent.Should().BeOfType<Border>().Which.StrokeShape
            .Should().BeOfType<Microsoft.Maui.Controls.Shapes.RoundRectangle>()
            .Which.CornerRadius.Should().Be(new CornerRadius(SharedTopBar.PillCornerRadius),
                "the capsule reuses the title pill's corner radius");
    }

    [Fact]
    public void SharedTopBar_BackButton_IsARecognizableLocalizedIcon()
    {
        var bar = new SharedTopBar { ShowBack = true };

        bar.BackButton.FontFamily.Should().Be("FluentIcons");
        SemanticProperties.GetDescription(bar.BackButton).Should().Be("חזור");
        bar.BackButton.AutomationId.Should().Be("TopBarBackButton");
    }

    [Fact]
    public void SharedTopBar_BackGlyph_MirrorsWithEffectiveFlowDirection()
    {
        var rtlPage = new ContentPage { FlowDirection = FlowDirection.RightToLeft };
        var rtlBar = new SharedTopBar();
        rtlPage.Content = rtlBar;
        rtlBar.BackButton.Text.Should().Be(Fonts.FluentUI.arrow_right_24_regular,
            "RTL Back points toward the leading (right) edge");

        var ltrPage = new ContentPage { FlowDirection = FlowDirection.LeftToRight };
        var ltrBar = new SharedTopBar();
        ltrPage.Content = ltrBar;
        ltrBar.BackButton.Text.Should().Be(Fonts.FluentUI.arrow_left_24_regular,
            "LTR Back points toward the leading (left) edge");
    }

    [Fact]
    public void SharedTopBar_BackSlot_StaysVisibleButDisabledAtRoot()
    {
        // Root versus pushed must not reorder chrome: the slot stays present
        // and grey instead of shifting the hamburger (#2467).
        var bar = new SharedTopBar { ShowBack = true };
        new ContentPage().Content = bar; // an unnavigated page has no back stack

        bar.RefreshBackState();

        bar.BackButton.IsVisible.Should().BeTrue("the slot is reserved at a root destination");
        bar.BackButton.IsEnabled.Should().BeFalse("nothing to return to at a root destination");
        bar.BackEnabled.Should().BeFalse();
    }

    [Fact]
    public void SharedTopBar_BackSlot_DisabledIsGenuinelyNonActionable()
    {
        var bar = new SharedTopBar { ShowBack = true };
        new ContentPage().Content = bar;
        var invocations = 0;
        bar.BackInvoker = () => { invocations++; return true; };

        bar.BackButton.SendClicked();

        invocations.Should().Be(0, "a disabled Back must not reach the back pipeline");
    }

    [Fact]
    public void SharedTopBar_BackSlot_EnabledByTransientReturnState()
    {
        // A root page that owns a transient surface (focused pasuk, open
        // sheet) reports it through the provider — the same surfaces the
        // shared back pipeline consumes first.
        var bar = new SharedTopBar { ShowBack = true };
        new ContentPage().Content = bar;
        bar.BackStateProvider = () => true;

        bar.RefreshBackState();

        bar.BackButton.IsEnabled.Should().BeTrue();
    }

    [Fact]
    public void SharedTopBar_BackClick_RevalidatesBeforeRouting()
    {
        var ownsSurface = false;
        var bar = new SharedTopBar { ShowBack = true };
        new ContentPage().Content = bar;
        bar.BackStateProvider = () => ownsSurface;
        var invocations = 0;
        bar.BackInvoker = () => { invocations++; return true; };

        bar.RefreshBackState();
        bar.BackButton.SendClicked();
        invocations.Should().Be(0, "a root with no return surface must never route Back");

        ownsSurface = true;
        bar.RefreshBackState();
        bar.BackButton.SendClicked();
        invocations.Should().Be(1, "an enabled Back rides the shared pipeline");

        ownsSurface = false;
        // The state flipped after the click — the next press re-verifies and
        // can never skip straight to exiting the app.
        bar.BackButton.SendClicked();
        invocations.Should().Be(1);
        bar.BackButton.IsEnabled.Should().BeFalse();
    }

    [Fact]
    public void SharedTopBar_HiddenBackSlot_KeepsHamburgerAnchored()
    {
        // Android default/hide removes the Back affordance entirely; the
        // hamburger remains the first (far-right) control in the capsule.
        var bar = new SharedTopBar { ShowBack = false };

        bar.BackButton.IsVisible.Should().BeFalse();
        bar.NavCapsule.Children[0].Should().BeSameAs(bar.NavigationButton);
    }

    [Fact]
    public void SharedTopBar_Hamburger_AlwaysOpensFlyout()
    {
        // The hamburger is never repurposed into Back/Close (#2467): there is
        // no interceptor seam — a tap only opens the flyout.
        var bar = new SharedTopBar();
        var opened = false;

        bar.FlyoutOpener = () => { opened = true; };
        bar.NavigationButton.SendClicked();

        opened.Should().BeTrue();
    }

    [Fact]
    public void SharedTopBar_Hamburger_WithoutOpener_IsAHarmlessNoOp()
    {
        // With no injected opener and no live Shell, a tap still must not
        // crash — the flyout fallback just has nowhere to go.
        var bar = new SharedTopBar();

        var act = () => bar.NavigationButton.SendClicked();

        act.Should().NotThrow();
    }

    [Fact]
    public void SharedTopBar_BackEnabled_FollowsTheStackDepthBoundary()
    {
        // stackDepth > 1 is the stack-side half of the Back state: exactly one
        // page (a root) keeps the slot disabled even though it stays visible.
        var bar = new SharedTopBar { ShowBack = true };

        bar.RefreshBackState(0);
        bar.BackEnabled.Should().BeFalse();
        bar.RefreshBackState(1);
        bar.BackEnabled.Should().BeFalse("a root page has nothing to go back to");

        bar.RefreshBackState(2);
        bar.BackEnabled.Should().BeTrue("a pushed page in the stack enables Back");
        bar.BackButton.IsEnabled.Should().BeTrue();
    }

    [Fact]
    public void SharedTopBar_BackGlyph_SkipsUndecidedAndNonVisualAncestors()
    {
        // Elements that never pin a flow direction (MatchParent) and
        // non-visual ancestors like the Window are skipped on the walk up.
        // When nothing decides, the Hebrew RTL default wins over any locale.
        var bar = new SharedTopBar();
        var host = new ContentView();
        var page = new ContentPage
        {
            FlowDirection = FlowDirection.MatchParent,
            Content = host,
        };
        _ = new Window(page);
        host.Content = bar;

        bar.BackButton.Text.Should().Be(Fonts.FluentUI.arrow_right_24_regular,
            "no ancestor pinned a direction, so the RTL default applies");
    }

    [Fact]
    public void SharedTopBar_BackSlot_WithoutPageAncestor_StaysDisabled()
    {
        // A bar outside the visual tree has no Page ancestor at all — the
        // ancestor walk must end safely instead of inventing a stack.
        var bar = new SharedTopBar { ShowBack = true };

        bar.RefreshBackState();

        bar.BackEnabled.Should().BeFalse("no Page ancestor means no back stack");
    }

    [Fact]
    public void SharedTopBar_BackSlot_WalksPastNonPageAncestors()
    {
        // Intermediate containers are not Pages — the stack-depth walk must
        // skip them and still land on the hosting Page's navigation stack.
        var bar = new SharedTopBar { ShowBack = true };
        var host = new ContentView();
        _ = new ContentPage { Content = host };
        host.Content = bar;

        bar.RefreshBackState();

        bar.BackEnabled.Should().BeFalse(
            "an unnavigated page past a ContentView wrapper still has no return target");
    }

    [Fact]
    public void SharedTopBar_BackClick_WithoutInvokerOrWindow_IsASafeNoOp()
    {
        // The default route is the shared IWindow.BackButtonClicked pipeline.
        // A bar outside any window has nothing to route to and must not throw.
        var bar = new SharedTopBar { ShowBack = true };
        bar.BackStateProvider = () => true;
        bar.RefreshBackState();

        var act = () => bar.BackButton.SendClicked();

        act.Should().NotThrow();
        bar.BackEnabled.Should().BeTrue("the provider still reports its surface");
    }

    private sealed class BackConsumingPage : ContentPage
    {
        public int BackPresses;

        protected override bool OnBackButtonPressed()
        {
            BackPresses++;
            return true;
        }
    }

    [Fact]
    public void SharedTopBar_BackClick_WithoutInvoker_RidesTheWindowBackPipeline()
    {
        // With no injected invoker the press reaches the real pipeline:
        // IWindow.BackButtonClicked dispatches to the page's own back
        // handling, which consumes it — never an app exit (#2467).
        var bar = new SharedTopBar { ShowBack = true };
        var page = new BackConsumingPage { Content = new ContentView { Content = bar } };
        _ = new Window(page);
        bar.BackStateProvider = () => true;
        bar.RefreshBackState();

        bar.BackButton.SendClicked();

        page.BackPresses.Should().Be(1,
            "the default invoker rides IWindow.BackButtonClicked into the page");
    }

    [Fact]
    public void SharedTopBar_BackClick_WindowDeclinesBack_LeavesStateIntact()
    {
        // The same default route when the page has nothing to consume: the
        // shared pipeline declines and the slot stays painted enabled.
        var bar = new SharedTopBar { ShowBack = true };
        var page = new ContentPage { Content = new ContentView { Content = bar } };
        _ = new Window(page);
        bar.BackStateProvider = () => true;
        bar.RefreshBackState();

        var act = () => bar.BackButton.SendClicked();

        act.Should().NotThrow();
        bar.BackEnabled.Should().BeTrue("the provider still owns the transient surface");
    }

    [Fact]
    public void SharedTopBar_CenterAndTrailingContent_RoundTrip()
    {
        var bar = new SharedTopBar();
        var center = new Label { Text = "center" };
        var trailing = new Label { Text = "trailing" };

        bar.CenterContent = center;
        bar.TrailingContent = trailing;

        bar.CenterContent.Should().BeSameAs(center);
        bar.TrailingContent.Should().BeSameAs(trailing);
    }

    [Fact]
    public void SharedTopBar_BarVisibleHidesControlsButKeepsSeparator()
    {
        var bar = new SharedTopBar();
        var container = (Grid)bar.Content!;
        var separator = container.Children.OfType<BoxView>().Single();

        bar.BarVisible = false;

        container.Children.OfType<Grid>().Single().IsVisible.Should().BeFalse();
        separator.IsVisible.Should().BeTrue("the reader keeps the hairline under the search overlay");
        bar.BarVisible = true;
        container.Children.OfType<Grid>().Single().IsVisible.Should().BeTrue();
    }

    [Fact]
    public void SharedTopBar_NavigationAutomationId_AppliesToHamburger()
    {
        var bar = new SharedTopBar { NavigationAutomationId = "AuthorsNavigationButton" };

        bar.NavigationButton.AutomationId.Should().Be("AuthorsNavigationButton");
    }

    [Fact]
    public void ToolbarPill_MatchesReaderPillChrome()
    {
        var pill = new ToolbarPill();

        pill.HeightRequest.Should().Be(40);
        pill.Padding.Should().Be(new Thickness(12, 0));
        pill.Margin.Should().Be(new Thickness(4, 0));
        pill.VerticalOptions.Should().Be(LayoutOptions.Center);
        pill.StrokeShape.Should().BeOfType<Microsoft.Maui.Controls.Shapes.RoundRectangle>()
            .Which.CornerRadius.Should().Be(new CornerRadius(14));
        pill.BackgroundColor.Should().Be(ToolbarPill.LightColor);
    }
}
