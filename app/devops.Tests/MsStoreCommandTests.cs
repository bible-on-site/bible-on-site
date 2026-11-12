using System.Collections.Concurrent;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Xunit;

[CollectionDefinition("MsStore command logging", DisableParallelization = true)]
public sealed class MsStoreCommandLoggingCollection
{
}

[Collection("MsStore command logging")]
public sealed class MsStoreCommandTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(19)]
    public void CommandStatusOnStderrDoesNotCreateErrorAnnotations(int exitCode)
    {
        var sink = new CapturedEvents();
        using var logger = new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger();
        var probe = Path.Join(AppContext.BaseDirectory, "coverage-scheduling-probe", "CoverageEndpointProbe.dll");

        var previousLogger = Log.Logger;
        Log.Logger = logger;
        try
        {
            // Capture NUKE's default stream logger too: stderr must not leak
            // error events before our command-outcome logger handles the lines.
            var actual = MsStoreCommand.Run("dotnet", $"\"{probe}\" msstore-output {exitCode}", logger);
            var output = sink.Events.Where(entry => entry.Properties.ContainsKey("MsStoreOutput")).ToArray();

            Assert.Equal(exitCode, actual);
            Assert.Equal(3, output.Length);
            Assert.Equal(new[] { "Command status on stdout", "Deleting Flight", "✅ \u001b[1;38;5;2mDeleted Flight\u001b[0m" }.Order(),
                output.Select(entry => entry.RenderMessage()).Order());
            Assert.All(output, entry => Assert.Equal(
                exitCode == 0 ? LogEventLevel.Information : LogEventLevel.Warning, entry.Level));
            Assert.DoesNotContain(sink.Events, entry => entry.Level >= LogEventLevel.Error);
        }
        finally
        {
            Log.Logger = previousLogger;
        }
    }

    private sealed class CapturedEvents : ILogEventSink
    {
        public ConcurrentQueue<LogEvent> Events { get; } = new();
        public void Emit(LogEvent logEvent) => Events.Enqueue(logEvent);
    }
}
