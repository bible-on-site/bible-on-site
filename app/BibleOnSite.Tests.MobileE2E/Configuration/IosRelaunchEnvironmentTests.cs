using BibleOnSite.Tests.MobileE2E.Platforms;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class IosRelaunchEnvironmentTests
{
    private static readonly IReadOnlyDictionary<string, string> ScenarioEnvironment =
        new Dictionary<string, string> { ["BIBLE_E2E_PERUSHIM"] = "1" };

    [Fact]
    public void EnvFreeRestartStaysOnActivateWhileBaselineEnvironmentIsStored()
    {
        var adapter = new IosPlatformAdapter();
        Assert.False(adapter.RequiresLaunchForEnvironment(null));
        Assert.False(adapter.RequiresLaunchForEnvironment(null));
    }

    [Fact]
    public void RestartAfterScenarioEnvironmentMustRelaunchToClearStoredVariables()
    {
        var adapter = new IosPlatformAdapter();
        Assert.True(adapter.RequiresLaunchForEnvironment(ScenarioEnvironment));
        // The scenario's launchApp stored BIBLE_E2E_PERUSHIM on WDA's app
        // object; XCTest activate() would relaunch the next scenario with it,
        // so the tracker must force one more full launch to replace it.
        Assert.True(adapter.RequiresLaunchForEnvironment(null));
        // That launch stored only the baseline environment; activate is safe
        // for every later scenario again.
        Assert.False(adapter.RequiresLaunchForEnvironment(null));
    }

    [Fact]
    public void SessionRecreationClearsTheStoredEnvironmentDebt()
    {
        var adapter = new IosPlatformAdapter();
        Assert.True(adapter.RequiresLaunchForEnvironment(ScenarioEnvironment));
        adapter.OnSessionRecreated();
        Assert.False(adapter.RequiresLaunchForEnvironment(null));
    }
}
