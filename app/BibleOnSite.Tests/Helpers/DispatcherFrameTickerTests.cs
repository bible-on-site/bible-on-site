using BibleOnSite.Helpers;
using Moq;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// The dispatcher-backed frame ticker (#3260): it wraps the platform timer the
/// dispatcher hands out — wiring the interval and tick at construction, then
/// forwarding Start/Stop.
/// </summary>
public class DispatcherFrameTickerTests
{
    [Fact]
    public void Constructor_CreatesTimerWithIntervalAndTickHandler()
    {
        var dispatcher = new Mock<IDispatcher>();
        var timer = new Mock<IDispatcherTimer>();
        dispatcher.Setup(d => d.CreateTimer()).Returns(timer.Object);
        var interval = TimeSpan.FromMilliseconds(25);
        var ticks = 0;

        _ = new DispatcherFrameTicker(dispatcher.Object, interval, () => ticks++);

        dispatcher.Verify(d => d.CreateTimer(), Times.Once);
        timer.VerifySet(t => t.Interval = interval);
        timer.VerifyAdd(t => t.Tick += It.IsAny<EventHandler>(), Times.Once);

        timer.Raise(t => t.Tick += null, EventArgs.Empty);
        ticks.Should().Be(1, "a timer tick forwards to the engine's frame callback");
    }

    [Fact]
    public void StartStop_ForwardToPlatformTimer()
    {
        var dispatcher = new Mock<IDispatcher>();
        var timer = new Mock<IDispatcherTimer>();
        dispatcher.Setup(d => d.CreateTimer()).Returns(timer.Object);
        var ticker = new DispatcherFrameTicker(dispatcher.Object, TimeSpan.FromMilliseconds(25), () => { });

        ticker.Start();
        ticker.Stop();

        timer.Verify(t => t.Start(), Times.Once);
        timer.Verify(t => t.Stop(), Times.Once);
    }
}
