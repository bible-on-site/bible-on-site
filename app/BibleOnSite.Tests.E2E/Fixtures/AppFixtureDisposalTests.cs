using System.Reflection;

namespace BibleOnSite.Tests.E2E.Fixtures;

[CollectionDefinition("Fixture cleanup", DisableParallelization = true)]
public class FixtureCleanupCollection;

[Collection("Fixture cleanup")]
public class AppFixtureDisposalTests
{
    private const BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;

    private static void SetField(AppFixture fixture, string name, object value) =>
        typeof(AppFixture).GetField(name, PrivateInstance)!.SetValue(fixture, value);

    private static Task Drain(AppFixture fixture, StreamReader reader, StreamWriter log) =>
        (Task)typeof(AppFixture).GetMethod("DrainPipe", PrivateInstance)!
            .Invoke(fixture, [reader, "[test]", log])!;

    private sealed class PendingReader(Stream stream) : StreamReader(stream)
    {
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<string?> ReadLineAsync(CancellationToken cancellationToken)
        {
            Started.TrySetResult();
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return null;
        }
    }

    private sealed class FailedLogWriter(Stream stream, bool failOnDispose) : StreamWriter(stream)
    {
        public bool WasDisposed { get; private set; }
        public override void WriteLine(string? value) => throw new IOException($"log disk unavailable: {value}");
        protected override void Dispose(bool disposing)
        {
            WasDisposed = true;
            base.Dispose(disposing);
            if (failOnDispose)
            {
                throw new IOException("log flush unavailable");
            }
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DisposeAsync_WhenTheLogSinkFailed_DisposesItAndPreservesTheDrainCause(bool failOnDispose)
    {
        var previous = Environment.GetEnvironmentVariable("E2E_COVERAGE");
        Environment.SetEnvironmentVariable("E2E_COVERAGE", "0");
        try
        {
            var fixture = new AppFixture();
            var original = new IOException("original drain failure");
            using var stream = new MemoryStream();
            var log = new FailedLogWriter(stream, failOnDispose);
            const BindingFlags fields = BindingFlags.Instance | BindingFlags.NonPublic;
            typeof(AppFixture).GetField("_drainFailure", fields)!.SetValue(fixture, original);
            typeof(AppFixture).GetField("_appLog", fields)!.SetValue(fixture, log);

            var failure = await Assert.ThrowsAsync<InvalidOperationException>(async () => await fixture.DisposeAsync());

            Assert.Same(original, failure.InnerException);
            Assert.True(log.WasDisposed);
            Assert.False(stream.CanWrite);
        }
        finally
        {
            Environment.SetEnvironmentVariable("E2E_COVERAGE", previous);
        }
    }

    [Fact]
    public async Task DisposeAsync_CancelsAndJoinsAnOutstandingReadBeforeDisposingTheLog()
    {
        var previous = Environment.GetEnvironmentVariable("E2E_COVERAGE");
        Environment.SetEnvironmentVariable("E2E_COVERAGE", "0");
        try
        {
            var fixture = new AppFixture();
            using var input = new MemoryStream();
            using var reader = new PendingReader(input);
            using var output = new MemoryStream();
            using var log = new StreamWriter(output);
            SetField(fixture, "_appLog", log);
            var drain = Drain(fixture, reader, log);
            SetField(fixture, "_drains", new[] { drain });
            await reader.Started.Task;

            await fixture.DisposeAsync();

            Assert.True(drain.IsCompletedSuccessfully);
            Assert.False(output.CanWrite);
        }
        finally
        {
            Environment.SetEnvironmentVariable("E2E_COVERAGE", previous);
        }
    }

    [Fact]
    public async Task TwoDrainFailures_PreserveTheFirstCauseThroughTeardown()
    {
        var previous = Environment.GetEnvironmentVariable("E2E_COVERAGE");
        Environment.SetEnvironmentVariable("E2E_COVERAGE", "0");
        try
        {
            var fixture = new AppFixture();
            using var output = new MemoryStream();
            var log = new FailedLogWriter(output, false);
            SetField(fixture, "_appLog", log);
            using var firstInput = new MemoryStream("first\n"u8.ToArray());
            using var firstReader = new StreamReader(firstInput);
            var first = Drain(fixture, firstReader, log);
            await first;
            var firstFailure = typeof(AppFixture).GetField("_drainFailure", PrivateInstance)!.GetValue(fixture);
            using var secondInput = new MemoryStream("second\n"u8.ToArray());
            using var secondReader = new StreamReader(secondInput);
            var second = Drain(fixture, secondReader, log);
            await second;
            SetField(fixture, "_drains", new[] { first, second });

            var failure = await Assert.ThrowsAsync<InvalidOperationException>(async () => await fixture.DisposeAsync());

            Assert.NotNull(firstFailure);
            Assert.Same(firstFailure, failure.InnerException);
            Assert.False(output.CanWrite);
        }
        finally
        {
            Environment.SetEnvironmentVariable("E2E_COVERAGE", previous);
        }
    }
}
