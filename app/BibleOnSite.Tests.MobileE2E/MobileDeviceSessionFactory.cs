using OpenQA.Selenium;
using OpenQA.Selenium.Appium;

namespace BibleOnSite.Tests.MobileE2E;

// Failed startup or cleanup can leave Appium operating on the device. A later
// session would race that work, including a stale session's shutdown timeout.
// Preserve the first failure and require a fresh runner before reusing the
// device — unless the failure matches DeviceSessionDeath, which only reports
// a session Appium already dropped server-side. Nothing is left to race then,
// so the next scenario may create a replacement session.
// Startup keeps a second exemption for DeviceTransportLoss: adb dropping is
// diagnosed and healed by DeviceTransportRecovery, and each new scenario gets
// its own honest failure plus a fresh recovery attempt instead of a memoized
// latch error. Cleanup has no such exemption — a lost transport leaves the
// server-side teardown unconfirmed, and nothing may race it, so it latches.
public sealed class MobileDeviceSessionFactory : IDisposable
{
    private Exception? _sessionFailure;

    // The session outlives individual scenarios: MobileDeviceTest resets app
    // state inside it instead of paying the WDA session handshake per test.
    // Cleared when a reset or teardown leaves the session suspect, so the next
    // scenario rebuilds it.
    public AppiumDriver? Shared { get; set; }

    public void Dispose()
    {
        try
        {
            Shared?.Quit();
        }
        catch (WebDriverException exception)
        {
            // The collection is done; a session the device already dropped has
            // nothing left to fail. Non-WebDriver teardown errors propagate.
            Console.WriteLine($"Shared session teardown failed: {exception.Message}");
        }
        finally
        {
            Shared?.Dispose();
        }
    }

    public T Create<T>(Func<T> createSession)
    {
        if (_sessionFailure != null)
        {
            throw new InvalidOperationException(
                "Device session startup or cleanup previously failed. Inspect the Appium logs before starting another session.",
                _sessionFailure);
        }

        try
        {
            return createSession();
        }
        catch (Exception exception)
        {
            if (!DeviceSessionDeath.Matches(exception) && !DeviceTransportLoss.Matches(exception))
            {
                _sessionFailure = exception;
            }
            throw;
        }
    }

    public void Cleanup(Action closeSession)
    {
        try
        {
            closeSession();
        }
        catch (Exception exception)
        {
            if (!DeviceSessionDeath.Matches(exception))
            {
                _sessionFailure ??= exception;
            }
            throw;
        }
    }
}
