using BibleOnSite.Controls;
using Microsoft.Maui;
using Microsoft.Maui.Animations;
using Microsoft.Maui.Controls;
using CoreAnimation = Microsoft.Maui.Animations.Animation;
using Microsoft.Maui.Dispatching;
using Microsoft.Maui.Layouts;

namespace BibleOnSite.Tests.Controls;

public class ReaderFanMenuTests
{
    /// <summary>
    /// Attaches a mocked MAUI context to a view tree so <c>FadeToAsync</c> and
    /// friends resolve an animation manager. The manager queues committed
    /// animations instead of running them — <see cref="TickAll"/> drives one
    /// long tick that lands every pending animation at its end value, so open
    /// and close transitions are fully deterministic.
    /// </summary>
    private sealed class TestContext
    {
        private readonly List<CoreAnimation> _pending = new();
        private readonly Mock<IMauiContext> _context = new();

        public TestContext()
        {
            var ticker = new Mock<ITicker>();
            ticker.SetupGet(t => t.SystemEnabled).Returns(true);
            var manager = new Mock<IAnimationManager>();
            manager.SetupGet(m => m.Ticker).Returns(ticker.Object);
            manager.Setup(m => m.Add(It.IsAny<CoreAnimation>())).Callback<CoreAnimation>(a => _pending.Add(a));
            manager.Setup(m => m.Remove(It.IsAny<CoreAnimation>())).Callback<CoreAnimation>(a => _pending.Remove(a));
            var dispatcher = new Mock<IDispatcher>();
            dispatcher.SetupGet(d => d.IsDispatchRequired).Returns(false);
            dispatcher.Setup(d => d.Dispatch(It.IsAny<Action>())).Returns((Action action) => { action(); return true; });
            var services = new Mock<IServiceProvider>();
            services.Setup(s => s.GetService(typeof(IDispatcher))).Returns(dispatcher.Object);
            services.Setup(s => s.GetService(typeof(IAnimationManager))).Returns(manager.Object);
            _context.SetupGet(c => c.Services).Returns(services.Object);
        }

        public void Attach(View view)
        {
            var handler = new Mock<IViewHandler>();
            handler.SetupGet(h => h.MauiContext).Returns(_context.Object);
            view.Handler = handler.Object;
            if (view is Layout layout)
            {
                foreach (var child in layout.Children.OfType<View>())
                {
                    Attach(child);
                }
            }
        }

        /// <summary>Completes every pending animation at its final value.</summary>
        public void TickAll()
        {
            foreach (var animation in _pending.ToArray())
            {
                animation.Tick(10_000);
            }
            _pending.RemoveAll(a => a.HasFinished);
        }
    }

    private static Grid ScrimOf(ReaderFanMenu menu) =>
        menu.Children.OfType<Grid>().Single(g => g.AutomationId == "CircularMenuScrim");

    private static AbsoluteLayout ContainerOf(ReaderFanMenu menu) =>
        menu.Children.OfType<AbsoluteLayout>().Single();

    private static void SendTapped(VisualElement owner, TapGestureRecognizer gesture) =>
        typeof(TapGestureRecognizer)
            .GetMethod("SendTapped", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
            .Invoke(gesture, [owner, null]);

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
                    ["PrimaryDark"] = Colors.DarkBlue
                }
            };
        }

        public void Dispose() => Application.Current = _previous;
    }

    [Fact]
    public void Constructor_RootIsHitTransparent_ButSatellitesCanOptBackIn()
    {
        var menu = new ReaderFanMenu();
        menu.InputTransparent.Should().BeTrue("a full-row root must not swallow iOS hit-tests of the reader beneath it");
        menu.CascadeInputTransparent.Should().BeFalse();
        ScrimOf(menu).IsVisible.Should().BeFalse();
        menu.ToggleButton.AutomationId.Should().Be("CircularMenuButton");
        menu.IsOpen.Should().BeFalse();
    }

    [Fact]
    public void SatelliteCtor_StartsHidden_AndUsesPrimaryDarkResource()
    {
        using var _ = new AppResources();
        var satellite = new ReaderFanMenuSatellite();
        satellite.Opacity.Should().Be(0);
        satellite.InputTransparent.Should().BeTrue();
        satellite.BackgroundColor.Should().Be(Colors.DarkBlue);
        satellite.CornerRadius.Should().Be(24);
    }

    [Fact]
    public void Satellites_AreInsertedBelowTheToggle_AndRemovalDropsTheirViews()
    {
        var menu = new ReaderFanMenu();
        var first = new ReaderFanMenuSatellite();
        var second = new ReaderFanMenuSatellite();
        menu.Satellites.Add(first);
        menu.Satellites.Add(second);
        var children = ContainerOf(menu).Children;
        children.Should().Contain(first).And.Contain(second);
        children[^1].Should().BeSameAs(menu.ToggleButton, "the toggle stays on top of the fan");
        menu.Satellites.Remove(first);
        ContainerOf(menu).Children.Should().NotContain(first).And.Contain(second);
    }

    [Fact]
    public void SetBottomInset_ShiftsContainerInsideTheGestureArea()
    {
        var menu = new ReaderFanMenu();
        menu.SetBottomInset(34);
        var container = ContainerOf(menu);
        container.TranslationY.Should().Be(34);
        container.Padding.Bottom.Should().Be(34);
    }

    [Fact]
    public void LayoutFan_PositionsToggleAndSatellitesInsideTheContainer()
    {
        var menu = new ReaderFanMenu();
        var satellite = new ReaderFanMenuSatellite();
        menu.Satellites.Add(satellite);
        var container = ContainerOf(menu);
        container.Arrange(new Rect(0, 0, 400, 800));
        var toggleBounds = AbsoluteLayout.GetLayoutBounds(menu.ToggleButton);
        toggleBounds.Width.Should().BeApproximately(56, 0.01);
        toggleBounds.Y.Should().BeGreaterThan(600, "the toggle docks at the bottom of the fan row");
        var satelliteBounds = AbsoluteLayout.GetLayoutBounds(satellite);
        satelliteBounds.Width.Should().BeApproximately(48, 0.01);
        satelliteBounds.Y.Should().BeLessThan(toggleBounds.Y, "satellites fan out above the toggle");
    }

    [Fact]
    public async Task OpenAsync_RaisesOpening_ShowsScrim_AndFadesSatellitesByEnabledState()
    {
        using var _ = new AppResources();
        var context = new TestContext();
        var menu = new ReaderFanMenu();
        var enabledSatellite = new ReaderFanMenuSatellite();
        var disabledSatellite = new ReaderFanMenuSatellite { IsEnabled = false };
        menu.Satellites.Add(enabledSatellite);
        menu.Satellites.Add(disabledSatellite);
        context.Attach(menu);

        var opened = false;
        menu.Opening += (_, _) => opened = true;
        var openTask = menu.OpenAsync();

        opened.Should().BeTrue("the page refreshes satellite CanExecute before the fade picks target opacity");
        menu.IsOpen.Should().BeTrue();
        enabledSatellite.InputTransparent.Should().BeFalse();
        enabledSatellite.Opacity.Should().Be(0, "satellites fade in from zero");
        ScrimOf(menu).IsVisible.Should().BeTrue();

        context.TickAll();
        await openTask;

        enabledSatellite.Opacity.Should().Be(1);
        disabledSatellite.Opacity.Should().BeApproximately(0.4, 0.001);
        ScrimOf(menu).IsVisible.Should().BeTrue();
        ScrimOf(menu).Opacity.Should().Be(1);
        menu.ToggleButton.Text.Should().Be(Fonts.FluentUI.dismiss_24_regular);
        menu.ToggleButton.BackgroundColor.Should().Be(Colors.Red);
        menu.ToggleButton.Rotation.Should().Be(180);
    }

    [Fact]
    public async Task CloseAsync_AfterOpen_HidesScrim_AndInputDisablesSatellites()
    {
        using var _ = new AppResources();
        var context = new TestContext();
        var menu = new ReaderFanMenu();
        var satellite = new ReaderFanMenuSatellite();
        menu.Satellites.Add(satellite);
        context.Attach(menu);
        var openTask = menu.OpenAsync();
        context.TickAll();
        await openTask;

        var closeTask = menu.CloseAsync();
        context.TickAll();
        await closeTask;

        menu.IsOpen.Should().BeFalse();
        menu.ToggleButton.Text.Should().Be(Fonts.FluentUI.navigation_24_regular);
        menu.ToggleButton.BackgroundColor.Should().Be(Colors.Blue);
        menu.ToggleButton.Rotation.Should().Be(0);
        ScrimOf(menu).IsVisible.Should().BeFalse();
        satellite.InputTransparent.Should().BeTrue();
        satellite.Opacity.Should().Be(0);
    }

    [Fact]
    public async Task ReopenDuringClose_KeepsScrimAndSatellitesInteractive()
    {
        using var _ = new AppResources();
        var context = new TestContext();
        var menu = new ReaderFanMenu();
        var satellite = new ReaderFanMenuSatellite();
        menu.Satellites.Add(satellite);
        context.Attach(menu);
        var firstOpen = menu.OpenAsync();
        context.TickAll();
        await firstOpen;

        // The close animations stay queued on the test ticker; the reopen aborts
        // them mid-flight and the close routine's "reopen wins" branch must keep
        // the scrim and satellites interactive instead of hiding them.
        var closeTask = menu.CloseAsync();
        menu.IsOpen.Should().BeFalse();
        var openTask = menu.OpenAsync();
        context.TickAll();
        await Task.WhenAll(closeTask, openTask);

        menu.IsOpen.Should().BeTrue();
        ScrimOf(menu).IsVisible.Should().BeTrue("a reopen during close keeps the scrim up");
        satellite.InputTransparent.Should().BeFalse();
        satellite.Opacity.Should().Be(1);
    }

    [Fact]
    public async Task ScrimTap_WhenOpen_ClosesTheFan()
    {
        using var _ = new AppResources();
        var context = new TestContext();
        var menu = new ReaderFanMenu();
        var satellite = new ReaderFanMenuSatellite();
        menu.Satellites.Add(satellite);
        context.Attach(menu);
        var openTask = menu.OpenAsync();
        context.TickAll();
        await openTask;

        var scrim = ScrimOf(menu);
        SendTapped(scrim, scrim.GestureRecognizers.OfType<TapGestureRecognizer>().Single());
        menu.IsOpen.Should().BeFalse("the tap flips the open flag synchronously");

        // The tap handler is async-void: its close animations are queued on the
        // test ticker — drive them, then yield until the continuation hides the scrim.
        context.TickAll();
        for (var i = 0; i < 100 && scrim.IsVisible; i++)
        {
            await Task.Yield();
        }

        scrim.IsVisible.Should().BeFalse();
        satellite.InputTransparent.Should().BeTrue();
    }

    [Fact]
    public void ScrimTap_WhenClosed_IsIgnored()
    {
        var menu = new ReaderFanMenu();
        var scrim = ScrimOf(menu);
        SendTapped(scrim, scrim.GestureRecognizers.OfType<TapGestureRecognizer>().Single());
        menu.IsOpen.Should().BeFalse();
    }

    [Fact]
    public void ToggleButtonClick_TogglesOpenAndClosed()
    {
        using var _ = new AppResources();
        var context = new TestContext();
        var menu = new ReaderFanMenu();
        context.Attach(menu);
        menu.ToggleButton.SendClicked();
        menu.IsOpen.Should().BeTrue();
        menu.ToggleButton.SendClicked();
        menu.IsOpen.Should().BeFalse();
        context.TickAll();
    }

    [Fact]
    public void TogglePressedReleased_DoNotThrow()
    {
        var menu = new ReaderFanMenu();
        var controller = (IButtonController)menu.ToggleButton;
        FluentActions.Invoking(() =>
        {
            controller.SendPressed();
            controller.SendReleased();
        }).Should().NotThrow();
    }

    [Fact]
    public async Task OpenClose_Guards_NoOpWhenAlreadyInTargetState()
    {
        using var _ = new AppResources();
        var context = new TestContext();
        var menu = new ReaderFanMenu();
        context.Attach(menu);
        await menu.CloseAsync();
        menu.IsOpen.Should().BeFalse();
        var openTask = menu.OpenAsync();
        context.TickAll();
        await openTask;
        await menu.OpenAsync();
        menu.IsOpen.Should().BeTrue();
        var toggleTask = menu.ToggleAsync();
        context.TickAll();
        await toggleTask;
        menu.IsOpen.Should().BeFalse();
    }

    [Fact]
    public async Task ResetToClosed_SnapsOpenFanBackInstantly()
    {
        using var _ = new AppResources();
        var context = new TestContext();
        var menu = new ReaderFanMenu();
        var satellite = new ReaderFanMenuSatellite();
        menu.Satellites.Add(satellite);
        context.Attach(menu);
        var openTask = menu.OpenAsync();
        context.TickAll();
        await openTask;

        menu.ResetToClosed();

        menu.IsOpen.Should().BeFalse();
        satellite.Opacity.Should().Be(0);
        satellite.InputTransparent.Should().BeTrue();
        menu.ToggleButton.Text.Should().Be(Fonts.FluentUI.navigation_24_regular);
        menu.ToggleButton.BackgroundColor.Should().Be(Colors.Blue);
        menu.ToggleButton.Rotation.Should().Be(0);
        ScrimOf(menu).Opacity.Should().Be(0);
        ScrimOf(menu).IsVisible.Should().BeFalse();
    }
}
