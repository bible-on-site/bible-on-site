using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Appium.Android;

namespace BibleOnSite.Tests.MobileE2E.Platforms;

// Same Execute funnel as IosSnapshotDriver: per-command timing plus the
// orientation-mutation tracking that lets window/orientation reads stay local.
internal sealed class AndroidTimedDriver(Uri server, AppiumOptions options)
    : AndroidDriver(server, options, TimeSpan.FromMinutes(4))
{
    protected override Response? Execute(string driverCommandToExecute, Dictionary<string, object>? parameters)
        => DriverTelemetry.Execute(this, driverCommandToExecute, parameters,
            () => base.Execute(driverCommandToExecute, parameters));
}
