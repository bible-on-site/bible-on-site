using System.Drawing;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium.Interactions;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class ReaderScrollActionsTests
{
    [Theory]
    [InlineData(61, true)]
    [InlineData(-50000, true)]
    [InlineData(1000, false)]
    public void ReturnMovesTowardTheHeadingThroughTheReaderGutter(int headingY, bool down)
    {
        var reader = new Rectangle(9, 202, 384, 672);
        var actions = Actions(ReaderScrollActions.ReturnToHeading(reader, new Size(402, 874),
            new Rectangle(22, headingY, 358, 115)));
        Assert.Equal(new[] { "pointerMove", "pointerDown", "pointerMove", "pointerUp" }, actions.Select(a => a["type"]));
        // The failed run touched x=201 inside selectable commentary. Its gutter
        // is x=9..21; the return must act on the outer collection instead.
        Assert.InRange(Convert.ToInt32(actions[0]["x"]), reader.Left + 1, 21);
        Assert.Equal(actions[0]["x"], actions[2]["x"]);
        var from = Convert.ToInt32(actions[0]["y"]);
        var to = Convert.ToInt32(actions[2]["y"]);
        Assert.Equal(down, to > from);
        Assert.InRange(from, reader.Top, reader.Bottom - 1);
        Assert.InRange(to, reader.Top, reader.Bottom - 1);
        Assert.Equal(350, Convert.ToInt32(actions[2]["duration"]));
    }

    [Fact]
    public void ReturnClipsTheContainerToTheCurrentWindow()
    {
        var actions = Actions(ReaderScrollActions.ReturnToHeading(
            new Rectangle(-20, -60, 500, 1000), new Size(402, 874), null));
        foreach (var move in actions.Where(action => Equals(action["type"], "pointerMove")))
        {
            Assert.InRange(Convert.ToInt32(move["x"]), 1, 401);
            Assert.InRange(Convert.ToInt32(move["y"]), 1, 873);
        }
    }

    [Fact]
    public void BrakeStopsMomentumInsideTheReaderGutter()
    {
        var reader = new Rectangle(9, 202, 384, 672);
        var actions = Actions(ReaderScrollActions.Brake(reader, new Size(402, 874)));
        Assert.Equal(new[] { "pointerMove", "pointerDown", "pointerMove", "pointerUp" }, actions.Select(a => a["type"]));
        // The brake must stay in the gutter (x=9..21) so the touch cannot reach
        // selectable commentary text or links.
        Assert.InRange(Convert.ToInt32(actions[0]["x"]), reader.Left + 1, 21);
        Assert.Equal(actions[0]["x"], actions[2]["x"]);
        // A short, slow drag takes scroll tracking to halt inertia; too far a
        // drag would act as another flick and too fast as a tap.
        var travel = Math.Abs(Convert.ToInt32(actions[2]["y"]) - Convert.ToInt32(actions[0]["y"]));
        Assert.InRange(travel, 8, 32);
        Assert.Equal(120, Convert.ToInt32(actions[2]["duration"]));
    }

    [Fact]
    public void BrakeRejectsAnOffscreenCarouselPage()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => ReaderScrollActions.Brake(
            new Rectangle(422, 202, 384, 672), new Size(402, 874)));
    }

    [Fact]
    public void ReturnRejectsAnOffscreenCarouselPage()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => ReaderScrollActions.ReturnToHeading(
            new Rectangle(422, 202, 384, 672), new Size(402, 874), null));
    }

    private static Dictionary<string, object>[] Actions(ActionSequence sequence) =>
        Assert.IsAssignableFrom<IEnumerable<object>>(sequence.ToDictionary()["actions"])
            .Select(action => Assert.IsType<Dictionary<string, object>>(action)).ToArray();
}
