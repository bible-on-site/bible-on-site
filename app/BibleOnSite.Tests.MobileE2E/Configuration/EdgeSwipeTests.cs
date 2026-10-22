using BibleOnSite.Tests.MobileE2E.Platforms;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class EdgeSwipeTests
{
    [Fact]
    public void RightEdgeSwipeStartsAtTheRightScreenEdgeAndTravelsInward()
    {
        var sequence = MobilePlatformAdapter.CreateEdgeSwipeSequence(new System.Drawing.Size(402, 874))
            .ToDictionary();
        Assert.Equal("pointer", sequence["type"]);
        var parameters = Assert.IsType<Dictionary<string, object>>(sequence["parameters"]);
        Assert.Equal("touch", parameters["pointerType"]);
        var actions = Assert.IsAssignableFrom<IEnumerable<object>>(sequence["actions"])
            .Select(action => Assert.IsType<Dictionary<string, object>>(action)).ToArray();

        Assert.Equal("pointerMove", actions[0]["type"]);
        Assert.Equal("viewport", actions[0]["origin"]);
        // width - 2: inside the native UIScreenEdgePanGestureRecognizer band.
        Assert.Equal(400, actions[0]["x"]);
        Assert.Equal(437, actions[0]["y"]);
        Assert.Equal("pointerDown", actions[1]["type"]);
        Assert.Equal("pointerUp", actions[^1]["type"]);

        var moves = actions.Skip(2).Take(actions.Length - 3).ToArray();
        Assert.Equal(6, moves.Length);
        var xs = moves.Select(move => Convert.ToInt32(move["x"])).ToArray();
        // Every drag step moves further left, ending at width / 3 — deep enough
        // that the native edge recognizer commits to the drawer gesture.
        Assert.Equal(xs.OrderByDescending(x => x).ToArray(), xs);
        Assert.Equal(134, xs[^1]);
        Assert.All(moves, move => Assert.Equal(437, move["y"]));
    }
}
