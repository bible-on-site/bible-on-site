using System.Reflection;

namespace BibleOnSite.Tests.E2E.Fixtures;

[CollectionDefinition("Fixture cleanup", DisableParallelization = true)]
public class FixtureCleanupCollection;

[Collection("Fixture cleanup")]
public class AppFixtureDisposalTests
{
    private sealed class FailedLogWriter() : StreamWriter(new MemoryStream())
    {
        public bool WasDisposed { get; private set; }
        public override void WriteLine(string? value) => throw new IOException("log disk unavailable");
        protected override void Dispose(bool disposing)
        {
            WasDisposed = true;
            base.Dispose(disposing);
        }
    }

    [Fact]
    public async Task DisposeAsync_WhenTheLogSinkFailed_DisposesItAndPreservesTheDrainCause()
    {
        var previous = Environment.GetEnvironmentVariable("E2E_COVERAGE");
        Environment.SetEnvironmentVariable("E2E_COVERAGE", "0");
        try
        {
            var fixture = new AppFixture();
            var original = new IOException("original drain failure");
            var log = new FailedLogWriter();
            const BindingFlags fields = BindingFlags.Instance | BindingFlags.NonPublic;
            typeof(AppFixture).GetField("_drainFailure", fields)!.SetValue(fixture, original);
            typeof(AppFixture).GetField("_appLog", fields)!.SetValue(fixture, log);

            var failure = await Assert.ThrowsAsync<InvalidOperationException>(async () => await fixture.DisposeAsync());

            Assert.Same(original, failure.InnerException);
            Assert.True(log.WasDisposed);
        }
        finally
        {
            Environment.SetEnvironmentVariable("E2E_COVERAGE", previous);
        }
    }
}
