using BibleOnSite.Controls;
using Microsoft.Maui;
using Microsoft.Maui.Animations;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Dispatching;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Tests.Controls;

public class MenuInteractionTests
{
    private sealed class AnimationHost
    {
        public Queue<Action> Delayed { get; } = new();
        public Mock<IDispatcher> Dispatcher { get; } = new();
        public Mock<IAnimationManager> Animations { get; } = new();
        private readonly Mock<IMauiContext> _context = new();

        public AnimationHost()
        {
            Dispatcher.Setup(d => d.Dispatch(It.IsAny<Action>())).Returns((Action action) => { action(); return true; });
            Dispatcher.Setup(d => d.DispatchDelayed(It.IsAny<TimeSpan>(), It.IsAny<Action>()))
                .Returns((TimeSpan _, Action action) => { Delayed.Enqueue(action); return true; });
            var ticker = new Mock<ITicker>();
            ticker.SetupGet(t => t.SystemEnabled).Returns(false);
            Animations.SetupGet(a => a.Ticker).Returns(ticker.Object);
            var services = new Mock<IServiceProvider>();
            services.Setup(s => s.GetService(typeof(IDispatcher))).Returns(Dispatcher.Object);
            services.Setup(s => s.GetService(typeof(IAnimationManager))).Returns(Animations.Object);
            _context.SetupGet(c => c.Services).Returns(services.Object);
        }

        public void Attach(View view)
        {
            var handler = new Mock<IViewHandler>();
            handler.SetupGet(h => h.MauiContext).Returns(_context.Object);
            view.Handler = handler.Object;
            if (view is ContentView content && content.Content != null)
            {
                Attach(content.Content);
            }
            if (view is Layout layout)
            {
                foreach (var child in layout.Children.OfType<View>())
                {
                    Attach(child);
                }
            }
        }

        public void FinishDelayed()
        {
            while (Delayed.TryDequeue(out var action))
            {
                action();
            }
        }
    }

    [Fact]
    public void Menu_OpensAndClosesFromToggleButton_AndDoesNotHideReopenedItems()
    {
        var host = new AnimationHost();
        var menu = new CircularMenu(0, Math.PI) { Radius = 100 };
        host.Attach(menu);
        var first = new CircularMenuItem();
        var second = new CircularMenuItem();
        host.Attach(first);
        host.Attach(second);
        menu.Items = [first, second];
        menu.Items.Should().HaveCount(2);
        var states = new List<bool>();
        menu.ExpandedChanged += (_, expanded) => states.Add(expanded);
        var button = ((Grid)menu.Content).Children.OfType<Button>().Single();
        button.SendClicked();
        menu.IsExpanded.Should().BeTrue();
        first.IsVisible.Should().BeTrue();
        first.TranslationX.Should().BeApproximately(100, 0.01);
        second.TranslationX.Should().BeApproximately(-100, 0.01);
        first.Opacity.Should().Be(1);
        first.Scale.Should().BeApproximately(1, 0.00001);
        menu.Open();
        states.Should().Equal(true);
        menu.Close();
        menu.Open();
        host.FinishDelayed();
        first.IsVisible.Should().BeTrue("a previous close must not hide an item after reopening");
        menu.Close();
        host.FinishDelayed();
        first.IsVisible.Should().BeFalse();
        first.TranslationX.Should().Be(0);
        first.Opacity.Should().Be(0);
        states.Should().Equal(true, false, true, false);
        new HtmlView().RaiseLinkTapped("https://example.test");
    }

    [Fact]
    public void Menu_ReplacingItems_RemovesOldVisuals_AndKeepsExpandedState()
    {
        var host = new AnimationHost();
        var menu = new CircularMenu();
        host.Attach(menu);
        var old = new CircularMenuItem();
        var replacement = new CircularMenuItem();
        host.Attach(old);
        host.Attach(replacement);
        menu.Items = [old];
        menu.Open();
        menu.Items = [replacement];
        ((Grid)menu.Content).Children.Should().NotContain(old).And.Contain(replacement);
        replacement.IsVisible.Should().BeTrue();
        menu.Items = [];
        ((Grid)menu.Content).Children.Should().ContainSingle().Which.Should().BeOfType<Button>();
        menu.Close();
        menu.Toggle();
        menu.IsExpanded.Should().BeTrue();
    }

    [Fact]
    public void Item_TapGestureRaisesTapped_WithItemAsSender()
    {
        var item = new CircularMenuItem();
        object? sender = null;
        item.Tapped += (s, _) => sender = s;
        var gesture = item.GestureRecognizers.OfType<TapGestureRecognizer>().Single();
        // MAUI's recognizer dispatch method is internal; invoke the actual gesture
        // entry point rather than calling the app's private event handler directly.
        typeof(TapGestureRecognizer).GetMethod("SendTapped", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
            .Invoke(gesture, [item, null]);
        sender.Should().BeSameAs(item);
    }

    [Fact]
    public void NavigationBar_ReplacesBothContents_AndRemovesPreviousMenu()
    {
        var bar = new BottomNavigationBar();
        var first = new Label();
        var second = new Label();
        bar.LeftContent = first;
        bar.LeftContent.Should().BeSameAs(first);
        bar.BarHeight = 100;
        bar.BarHeight.Should().Be(100);
        bar.LeftContent = second;
        bar.RightContent = first;
        bar.RightContent.Should().BeSameAs(first);
        bar.RightContent = second;
        bar.LeftContent = null;
        bar.RightContent = null;
        var menu = new CircularMenu();
        bar.CircularMenu = menu;
        bar.CircularMenu = null;
        bar.CircularMenu.Should().BeNull();
        ((AbsoluteLayout)bar.Content).Children.Should().NotContain(menu);
        bar.BarColor = Colors.Red;
        bar.BarColor.Should().Be(Colors.Red);
        bar.NotchRadius = 40;
        bar.NotchRadius.Should().Be(40);
        ((AbsoluteLayout)bar.Content).Children.OfType<BottomBarBackground>().Single().BarColor.Should().Be(Colors.Red);
    }

    [Fact]
    public void Drawable_FillsClosedNotchedPath_AndAppliesShadow()
    {
        var canvas = new Mock<ICanvas>();
        PathF? path = null;
        canvas.Setup(c => c.FillPath(It.IsAny<PathF>(), It.IsAny<WindingMode>())).Callback<PathF, WindingMode>((p, _) => path = p);
        var bounds = new RectF(0, 0, 400, 80);
        new BottomBarDrawable().Draw(canvas.Object, bounds);
        canvas.VerifySet(c => c.FillColor = Colors.Transparent, Times.Once);
        canvas.Verify(c => c.FillRectangle(0, 0, 400, 80), Times.Once);
        canvas.Verify(c => c.SetShadow(new SizeF(0, -2), 6, It.IsAny<Color>()), Times.Once);
        canvas.Verify(c => c.SetFillPaint(It.IsAny<SolidPaint>(), bounds), Times.Once);
        path.Should().NotBeNull();
        path!.Points.Should().Contain(new PointF(0, 80)).And.Contain(new PointF(400, 80));
    }
}
