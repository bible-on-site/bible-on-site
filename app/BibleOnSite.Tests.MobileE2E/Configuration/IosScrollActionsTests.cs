using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class IosScrollActionsTests
{
    [Theory]
    [InlineData(712, 328)]
    [InlineData(328, 712)]
    public void ScrollStormPreservesFortyShortLiftedTouchesInEachDirection(int fromY, int toY)
    {
        var sequence = PerekScrollStabilityTests.CreateFlickSequence(201, fromY, 201, toY, 40).ToDictionary();
        Assert.Equal("pointer", sequence["type"]);
        var parameters = Assert.IsType<Dictionary<string, object>>(sequence["parameters"]);
        Assert.Equal("touch", parameters["pointerType"]);
        var actions = Assert.IsAssignableFrom<IEnumerable<object>>(sequence["actions"])
            .Select(action => Assert.IsType<Dictionary<string, object>>(action)).ToArray();
        Assert.Equal(199, actions.Length);
        Assert.Equal(40, actions.Count(action => Equals(action["type"], "pointerDown")));
        Assert.Equal(40, actions.Count(action => Equals(action["type"], "pointerUp")));
        for (var gesture = 0; gesture < 40; gesture++)
        {
            var start = gesture * 5;
            Assert.Equal(new[] { "pointerMove", "pointerDown", "pointerMove", "pointerUp" },
                actions.Skip(start).Take(4).Select(action => action["type"]));
            Assert.Equal("viewport", actions[start]["origin"]);
            Assert.Equal(201, actions[start]["x"]);
            Assert.Equal(fromY, actions[start]["y"]);
            Assert.Equal(0, Convert.ToInt32(actions[start]["duration"]));
            Assert.Equal("viewport", actions[start + 2]["origin"]);
            Assert.Equal(201, actions[start + 2]["x"]);
            Assert.Equal(toY, actions[start + 2]["y"]);
            Assert.Equal(120, Convert.ToInt32(actions[start + 2]["duration"]));
            if (gesture < 39)
            {
                Assert.Equal("pause", actions[start + 4]["type"]);
                Assert.Equal(100, Convert.ToInt32(actions[start + 4]["duration"]));
            }
        }
    }
}
