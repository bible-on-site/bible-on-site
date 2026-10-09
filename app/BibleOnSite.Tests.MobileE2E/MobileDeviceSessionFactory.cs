namespace BibleOnSite.Tests.MobileE2E;

// Shared by the sequential device collection. A client-side startup failure can
// leave Appium preparing the device, so later scenarios must not start a second
// session on it. Preserve the failure instead of retrying an indeterminate device.
public sealed class MobileDeviceSessionFactory
{
    private Exception? _startupFailure;

    public T Create<T>(Func<T> createSession)
    {
        if (_startupFailure != null)
        {
            throw new InvalidOperationException(
                "Device session startup previously failed. Inspect the Appium logs before starting another session.",
                _startupFailure);
        }

        try
        {
            return createSession();
        }
        catch (Exception exception)
        {
            _startupFailure = exception;
            throw;
        }
    }
}
