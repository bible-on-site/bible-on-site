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
        band.ColumnDefinitions.Select(column => column.Width.Value)
            .Should().Equal(new[] { GridLength.Auto.Value, GridLength.Star.Value, 48.0 },
                "the capsule sizes to its content so the group width stays stable");

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
