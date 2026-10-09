namespace BibleOnSite.Tests.MobileE2E;

// Failed startup or cleanup can leave Appium operating on the device. A later
// session would race that work, including a stale session's shutdown timeout.
// Preserve the first failure and require a fresh runner before reusing the
// device — unless the failure matches DeviceSessionDeath, which only reports
// a session Appium already dropped server-side. Nothing is left to race then,
// so the next scenario may create a replacement session.
public sealed class MobileDeviceSessionFactory
{
    private Exception? _sessionFailure;

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
            if (!DeviceSessionDeath.Matches(exception))
            {
                _sessionFailure ??= exception;
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
