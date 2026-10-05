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
}
