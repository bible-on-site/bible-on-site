using System.Collections.ObjectModel;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium.Interfaces;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class AnyOfLocatorTests
{
    [Fact]
    public void IosCombinesAutomationIdsIntoOneNamePredicate()
    {
        // MobileBy leaves Selenium's Mechanism/Criteria empty; capture what it
        // sends to the driver instead.
        var capture = new LocatorCapture();
        new IosPlatformAdapter().AnyOfAutomationIds("SearchPanel", "PerekSearchInput").FindElements(capture);
        Assert.Equal("-ios predicate string", capture.Mechanism);
        Assert.Equal("name IN {'SearchPanel','PerekSearchInput'}", capture.Criteria);
    }

    [Fact]
    public void AndroidCombinesAutomationIdsIntoOneResourceIdLookup()
    {
        var locator = new AndroidPlatformAdapter().AnyOfAutomationIds("SearchPanel", "PerekSearchInput");
        Assert.Equal("xpath", locator.Mechanism);
        Assert.Equal("//*[@resource-id='com.tanah.daily929:id/SearchPanel' or @resource-id='com.tanah.daily929:id/PerekSearchInput']",
            locator.Criteria);
    }

    [Theory]
    [InlineData("Search'Panel")]
    [InlineData("")]
    public void RejectsIdsThatAreNotPlainIdentifiers(string id)
    {
        Assert.Throws<ArgumentException>(() => new IosPlatformAdapter().AnyOfAutomationIds("SearchPanel", id));
    }

    private sealed class LocatorCapture : ISearchContext, IFindsByFluentSelector<IWebElement>
    {
        public string Mechanism { get; private set; } = string.Empty;
        public string Criteria { get; private set; } = string.Empty;
        public IReadOnlyCollection<IWebElement> FindElements(string selector, string value)
        {
            Mechanism = selector;
            Criteria = value;
            return Array.Empty<IWebElement>();
        }
        public ReadOnlyCollection<IWebElement> FindElements(By by) => throw new NotSupportedException();
        public IWebElement FindElement(By by) => throw new NotSupportedException();
        public IWebElement FindElement(string selector, string value) => throw new NotSupportedException();
    }
}
