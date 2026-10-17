using BibleOnSite.Tests.MobileE2E.Platforms;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class AnyOfLocatorTests
{
    [Fact]
    public void IosCombinesAutomationIdsIntoOneNameLookup()
    {
        var locator = new IosPlatformAdapter().AnyOfAutomationIds("SearchPanel", "PerekSearchInput");
        Assert.Equal("xpath", locator.Mechanism);
        Assert.Equal("//*[@name='SearchPanel' or @name='PerekSearchInput']", locator.Criteria);
    }

    [Fact]
    public void AndroidCombinesAutomationIdsIntoOneResourceIdLookup()
    {
        var locator = new AndroidPlatformAdapter().AnyOfAutomationIds("SearchPanel", "PerekSearchInput");
        Assert.Equal("xpath", locator.Mechanism);
        Assert.Equal("//*[@resource-id='com.tanah.daily929:id/SearchPanel' or @resource-id='com.tanah.daily929:id/PerekSearchInput']",
            locator.Criteria);
    }
}
