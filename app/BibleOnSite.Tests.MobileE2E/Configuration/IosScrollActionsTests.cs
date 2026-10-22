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
        var bursts = PerekScrollStabilityTests.CreateFlickBursts(201, fromY, 201, toY, 40);
        Assert.Equal(20, bursts.Count);
        var totalTouches = 0;
        foreach (var burst in bursts)
        {
            var sequence = burst.ToDictionary();
            Assert.Equal("pointer", sequence["type"]);
            var parameters = Assert.IsType<Dictionary<string, object>>(sequence["parameters"]);
            Assert.Equal("touch", parameters["pointerType"]);
            var actions = Actions(burst);
            Assert.Equal(9, actions.Length);
            Assert.Equal(2, actions.Count(action => Equals(action["type"], "pointerDown")));
            Assert.Equal(2, actions.Count(action => Equals(action["type"], "pointerUp")));
            totalTouches += 2;
            for (var gesture = 0; gesture < 2; gesture++)
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
                if (gesture < 1)
                {
                    Assert.Equal("pause", actions[start + 4]["type"]);
                    Assert.Equal(100, Convert.ToInt32(actions[start + 4]["duration"]));
                }
            }
        }
        Assert.Equal(40, totalTouches);
    }

    [Fact]
    public void PartialBurstPreservesTheRemainingTouchesWithoutRoundingUp()
    {
        var bursts = PerekScrollStabilityTests.CreateFlickBursts(201, 712, 201, 328, 23);
        Assert.Equal(Enumerable.Repeat(2, 11).Append(1), bursts.Select(burst =>
            Actions(burst).Count(action => Equals(action["type"], "pointerUp"))));
        Assert.All(bursts, burst => Assert.Equal("pointerUp", Actions(burst)[^1]["type"]));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            PerekScrollStabilityTests.CreateFlickBursts(201, 712, 201, 328, 0));
    }

    private static Dictionary<string, object>[] Actions(OpenQA.Selenium.Interactions.ActionSequence sequence) =>
        Assert.IsAssignableFrom<IEnumerable<object>>(sequence.ToDictionary()["actions"])
            .Select(action => Assert.IsType<Dictionary<string, object>>(action)).ToArray();
}
