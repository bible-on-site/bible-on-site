using BibleOnSite.Services;
using System.Reflection;

namespace BibleOnSite.Tests.Services;

public class AnalyticsServiceTests
{
    [Fact]
    public void IsAvailable_OnUnitTestHost_IsFalse()
    {
        // Firebase only exists on ANDROID/IOS builds; every other platform
        // compiles the `false` branch.
        typeof(AnalyticsService)
            .GetProperty("IsAvailable", BindingFlags.Static | BindingFlags.NonPublic)!
            .GetValue(null)
            .Should().Be(false);
    }
}
