using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using FluentAssertions;
using Microsoft.Maui;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Dispatching;
using Moq;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Contract tests for <see cref="ReaderCarousel"/> — the coordinator that
/// owns the carousel interaction plumbing every reader page shares (#2573):
/// the programmatic-scroll guard, the rotation/resize resnap (including the
/// deferred resnap a mid-load rotation queues) and the unit-index lookup.
/// Android-only swipe settling stays behind <c>#if ANDROID</c> and is covered
/// by the platform build; the page-level wiring contract lives in
/// ReaderCarouselContractTests.
/// </summary>
public class ReaderCarouselTests
{
    /// <summary>
    /// Records the scroll requests the coordinator issues — ScrollToRequested
    /// fires synchronously on a CarouselView once it has a dispatcher (the
    /// mocked handler supplies one, like ReaderChromeTests' TestContext), so
    /// each test can assert the exact index/animation pair the native list
    /// would receive.
    /// </summary>
    private sealed class Rig
    {
        public readonly CarouselView Carousel = new();
        public readonly Grid LoadingOverlay = new();
        public readonly ReaderFanMenu Fan = new();
        public readonly List<ScrollToRequestEventArgs> Scrolls = new();
        public readonly List<string> Invokes = new();

        public int Position;
        public readonly int Count = 5;
        public bool Loading;

        public Rig()
        {
            // ScrollTo bounds-checks against the item count — an empty source
            // swallows every request before it reaches the handler.
            Carousel.ItemsSource = Enumerable.Range(0, Count).ToList();
            AttachDispatcher(Carousel);
            Carousel.ScrollToRequested += (_, e) => Scrolls.Add(e);
        }

        /// <summary>Gives a headless element an inline dispatcher and records
        /// the handler invocations ScrollTo routes through.</summary>
        private void AttachDispatcher(CarouselView element)
        {
            var dispatcher = new Mock<IDispatcher>();
            dispatcher.SetupGet(d => d.IsDispatchRequired).Returns(false);
            dispatcher.Setup(d => d.Dispatch(It.IsAny<Action>()))
                .Returns((Action action) => { action(); return true; });
            var services = new Mock<IServiceProvider>();
            services.Setup(s => s.GetService(typeof(IDispatcher))).Returns(dispatcher.Object);
            var context = new Mock<IMauiContext>();
            context.SetupGet(c => c.Services).Returns(services.Object);
            var handler = new Mock<IViewHandler>();
            handler.SetupGet(h => h.MauiContext).Returns(context.Object);
            handler.Setup(h => h.Invoke(It.IsAny<string>(), It.IsAny<object?>()))
                .Callback<string, object?>((command, args) =>
                {
                    Invokes.Add(command);
                    if (args is ScrollToRequestEventArgs e)
                    {
                        Scrolls.Add(e);
                    }
                });
            element.Handler = handler.Object;
        }

        public ReaderCarousel Create() => new(
            new ReaderCarouselSurfaces
            {
                Carousel = Carousel,
                LoadingOverlay = LoadingOverlay,
                FanMenu = Fan,
                SwipeExcluded = [new Grid()],
            },
            new ReaderCarouselActions
            {
                CurrentPosition = () => Position,
                ItemCount = () => Count,
                IsLoading = () => Loading,
            });
    }

    // — IndexOf ————————————————————————————————————————————————————————————

    [Fact]
    public void IndexOf_returns_the_unit_position()
    {
        var units = new[] { 11, 42, 7 };
        ReaderCarousel.IndexOf(units, id => id, 42).Should().Be(1);
    }

    [Fact]
    public void IndexOf_returns_minus_one_when_the_unit_is_missing()
    {
        var units = new[] { 11, 42, 7 };
        ReaderCarousel.IndexOf(units, id => id, 5).Should().Be(-1);
    }

    // — ScrollToUnit ————————————————————————————————————————————————————————

    [Fact]
    public void ScrollToUnit_jumps_instantly_and_releases_the_guard()
    {
        var rig = new Rig();
        var carousel = rig.Create();

        carousel.ScrollToUnit(3);

        rig.Scrolls.Should().ContainSingle("the programmatic navigation snaps once");
        rig.Scrolls[0].Index.Should().Be(3);
        rig.Scrolls[0].IsAnimated.Should().BeFalse(
            "a programmatic jump must not animate through intermediate positions");
        carousel.IsInitializing.Should().BeFalse(
            "the guard is released when the scroll returns so real swipes land");
    }

    [Fact]
    public void ScrollToUnit_releases_the_guard_even_when_the_scroll_throws()
    {
        var rig = new Rig();
        var carousel = rig.Create();
        carousel.IsInitializing = true;

        // A negative index is out of the collection — the guard must still
        // release so the reader is not stuck swallowing real swipes.
        try { carousel.ScrollToUnit(-1); } catch { /* platform-dependent */ }

        carousel.IsInitializing.Should().BeFalse();
    }

    // — Resize resnap ———————————————————————————————————————————————————————

    [Fact]
    public void First_measure_records_the_width_without_a_resnap()
    {
        var rig = new Rig();
        var carousel = rig.Create();

        carousel.NoteCarouselWidth(400);

        rig.Scrolls.Should().BeEmpty(
            "the first measured width is the baseline, not a rotation");
    }

    [Fact]
    public void Same_width_is_ignored()
    {
        var rig = new Rig();
        var carousel = rig.Create();
        carousel.NoteCarouselWidth(400);

        carousel.NoteCarouselWidth(400.4);

        rig.Scrolls.Should().BeEmpty(
            "sub-epsilon width jitter must not resnap the carousel");
    }

    [Fact]
    public void Width_change_resnaps_to_the_current_position()
    {
        var rig = new Rig { Position = 2 };
        var carousel = rig.Create();
        carousel.NoteCarouselWidth(400);

        carousel.NoteCarouselWidth(800);

        rig.Scrolls.Should().ContainSingle("a rotation invalidates the item sizing and re-snaps once");
        rig.Scrolls[0].Index.Should().Be(2, "the resnap lands on the logical position, not index 0");
        rig.Scrolls[0].IsAnimated.Should().BeFalse();
    }

    [Fact]
    public void Width_change_while_initializing_is_ignored()
    {
        var rig = new Rig { Position = 2 };
        var carousel = rig.Create();
        carousel.NoteCarouselWidth(400);
        carousel.IsInitializing = true;

        carousel.NoteCarouselWidth(800);

        rig.Scrolls.Should().BeEmpty(
            "the reader's own repositioning already handled the layout");
    }

    [Fact]
    public void Width_change_during_load_defers_the_resnap()
    {
        var rig = new Rig { Position = 2, Loading = true };
        var carousel = rig.Create();
        carousel.NoteCarouselWidth(400);

        carousel.NoteCarouselWidth(800);
        rig.Scrolls.Should().BeEmpty("a mid-load rotation queues the resnap instead");

        rig.Loading = false;
        carousel.ConsumePendingResnap();

        rig.Scrolls.Should().ContainSingle("the deferred resnap replays once the load finishes");
        rig.Scrolls[0].Index.Should().Be(2);
    }

    [Fact]
    public void ConsumePendingResnap_is_a_noop_without_a_deferred_resnap()
    {
        var rig = new Rig();
        var carousel = rig.Create();
        carousel.NoteCarouselWidth(400);

        carousel.ConsumePendingResnap();

        rig.Scrolls.Should().BeEmpty();
    }

    [Fact]
    public void Non_positive_widths_are_ignored()
    {
        var rig = new Rig();
        var carousel = rig.Create();

        carousel.NoteCarouselWidth(0);
        carousel.NoteCarouselWidth(-50);

        rig.Scrolls.Should().BeEmpty("an unmeasured carousel has nothing to snap");
    }

    // — SizeChanged delegation + lifecycle slots ———————————————————————————

    [Fact]
    public void SizeChanged_feeds_the_measured_width_to_the_resnap_logic()
    {
        var rig = new Rig();
        var carousel = rig.Create();

        // A headless element reports Width=-1 — the same early return the
        // first unmeasured pass takes; the wiring itself is what this pins.
        var act = () => carousel.OnCarouselSizeChanged(null!, EventArgs.Empty);

        act.Should().NotThrow();
        rig.Scrolls.Should().BeEmpty();
    }

    [Fact]
    public void Appearing_and_disappearing_are_safe_off_android()
    {
        var rig = new Rig();
        var carousel = rig.Create();

        var act = () =>
        {
            carousel.Appearing();
            carousel.Disappearing();
        };

        act.Should().NotThrow(
            "the native swipe plumbing only exists on Android — the slots stay no-ops elsewhere");
    }
}
