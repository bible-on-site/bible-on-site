using OpenQA.Selenium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class SessionFactoryTests
{
    [Fact]
    public void SuccessfulSessionsAllowTheNextScenarioToCreateFreshState()
    {
        var factory = new MobileDeviceSessionFactory();
        var first = factory.Create(() => new object());
        var second = factory.Create(() => new object());
        Assert.NotSame(first, second);
    }

    [Fact]
    public void FailedStartupPreventsOverlappingSetupAndPreservesItsCause()
    {
        var factory = new MobileDeviceSessionFactory();
        var failure = new TimeoutException("Session creation timed out while the server was still preparing the device.");
        Assert.Same(failure, Assert.Throws<TimeoutException>(() => factory.Create<object>(() => throw failure)));

        var attemptedAnotherSession = false;
        var blocked = Assert.Throws<InvalidOperationException>(() => factory.Create(() =>
        {
            attemptedAnotherSession = true;
            return new object();
        }));
        Assert.False(attemptedAnotherSession);
        Assert.Same(failure, blocked.InnerException);
    }

    [Fact]
    public void FailedCleanupPreventsAReplacementSessionFromRacingTheOldShutdown()
    {
        var factory = new MobileDeviceSessionFactory();
        factory.Create(() => new object());
        var failure = new InvalidOperationException("DELETE /session failed: adb device offline; remote cleanup is uncertain.");
        Assert.Same(failure, Assert.Throws<InvalidOperationException>(() => factory.Cleanup(() => throw failure)));

        var attemptedReplacement = false;
        var blocked = Assert.Throws<InvalidOperationException>(() => factory.Create(() =>
        {
            attemptedReplacement = true;
            return new object();
        }));
        Assert.False(attemptedReplacement);
        Assert.Same(failure, blocked.InnerException);
    }

    [Fact]
    public void ConfirmedSessionDeathDoesNotBlockTheNextScenario()
    {
        // A death-classified failure means Appium already dropped the session
        // server-side; nothing remains that a replacement session could race.
        var factory = new MobileDeviceSessionFactory();
        Assert.Throws<UnknownErrorException>(() => factory.Create<object>(() =>
            throw new UnknownErrorException("A session is either terminated or not started")));

        Assert.NotNull(factory.Create(() => new object()));
    }

    [Fact]
    public void ClosingAnAlreadyDeadSessionDoesNotBlockTheNextScenario()
    {
        var factory = new MobileDeviceSessionFactory();
        factory.Create(() => new object());
        Assert.Throws<UnknownErrorException>(() => factory.Cleanup(() =>
            throw new UnknownErrorException("invalid session id")));

        Assert.NotNull(factory.Create(() => new object()));
    }

    [Fact]
    public void TransportLossDuringStartupDoesNotLatchTheDevice()
    {
        // adb dropping is self-diagnosing: recovery earns the retry, and a
        // still-dead transport reports the real error per scenario instead of
        // a memoized latch failure.
        var factory = new MobileDeviceSessionFactory();
        Assert.Throws<UnknownErrorException>(() => factory.Create<object>(() =>
            throw new UnknownErrorException("adb: device offline")));

        Assert.NotNull(factory.Create(() => new object()));
    }

    [Fact]
    public void TransportLossDuringCleanupStillBlocksReuse()
    {
        // A lost transport leaves the server-side teardown unconfirmed; a
        // replacement session may not race it, so the failure latches.
        var factory = new MobileDeviceSessionFactory();
        factory.Create(() => new object());
        var failure = new UnknownErrorException("DELETE /session failed: adb: device offline");
        Assert.Same(failure, Assert.Throws<UnknownErrorException>(() => factory.Cleanup(() => throw failure)));

        var attemptedReplacement = false;
        var blocked = Assert.Throws<InvalidOperationException>(() => factory.Create(() =>
        {
            attemptedReplacement = true;
            return new object();
        }));
        Assert.False(attemptedReplacement);
        Assert.Same(failure, blocked.InnerException);
    }

    [Fact]
    public void ConfirmedCleanupStillAllowsTheNextScenario()
    {
        var factory = new MobileDeviceSessionFactory();
        var first = factory.Create(() => new object());
        var closed = false;
        factory.Cleanup(() => closed = true);
        var next = factory.Create(() => new object());
        Assert.True(closed);
        Assert.NotSame(first, next);
    }

    [Fact]
    public void CleanupFailureDoesNotReplaceTheOriginalStartupFailure()
    {
        var factory = new MobileDeviceSessionFactory();
        var startup = new TimeoutException("indeterminate startup");
        Assert.Throws<TimeoutException>(() => factory.Create<object>(() => throw startup));
        Assert.Throws<InvalidOperationException>(() => factory.Cleanup(() => throw new InvalidOperationException("cleanup also failed")));
        var blocked = Assert.Throws<InvalidOperationException>(() => factory.Create(() => new object()));
        Assert.Same(startup, blocked.InnerException);
    }
}
