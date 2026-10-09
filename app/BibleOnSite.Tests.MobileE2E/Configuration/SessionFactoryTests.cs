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
