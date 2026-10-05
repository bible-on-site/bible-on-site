using BibleOnSite.Tests.MobileE2E.Platforms;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class IosTapTests
{
    [Fact]
    public void ObservedMenuFrameProducesOneShortTouchAtItsViewportCenter()
    {
        // The failed runner reported this frame for the menu. Its local center
        // (28, 28) is outside the button when interpreted as viewport coordinates.
        var sequence = IosPlatformAdapter.CreateTapSequence(new(173, 752), new(56, 57)).ToDictionary();
        Assert.Equal("pointer", sequence["type"]);
        var parameters = Assert.IsType<Dictionary<string, object>>(sequence["parameters"]);
        Assert.Equal("touch", parameters["pointerType"]);
        var actions = Assert.IsAssignableFrom<IEnumerable<object>>(sequence["actions"])
            .Select(action => Assert.IsType<Dictionary<string, object>>(action)).ToArray();
        Assert.Equal(new[] { "pointerMove", "pointerDown", "pause", "pointerUp" },
            actions.Select(action => action["type"]));
        Assert.Equal("viewport", actions[0]["origin"]);
        Assert.Equal(201, actions[0]["x"]);
        Assert.Equal(780, actions[0]["y"]);
        Assert.InRange(Convert.ToDouble(actions[2]["duration"]), 1, 499);
        Assert.Equal(0, actions[1]["button"]);
        Assert.Equal(0, actions[3]["button"]);
    }
}
