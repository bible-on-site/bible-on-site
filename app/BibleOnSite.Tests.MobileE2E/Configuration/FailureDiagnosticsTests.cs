using System.Diagnostics;
using System.Text.Json;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[CollectionDefinition("Failure diagnostics environment", DisableParallelization = true)]
public sealed class FailureDiagnosticsCollection;

[Collection("Failure diagnostics environment")]
[Trait("Category", "Unit")]
public sealed class FailureDiagnosticsTests : IDisposable
{
    private readonly string _directory = Path.Join(Path.GetTempPath(), $"failure-diagnostics-{Guid.NewGuid():N}");
    private readonly string? _previous = Environment.GetEnvironmentVariable(FailureDiagnostics.DirectoryVariable);
    private readonly List<string> _log = [];

    public FailureDiagnosticsTests()
    {
        Directory.CreateDirectory(_directory);
        Environment.SetEnvironmentVariable(FailureDiagnostics.DirectoryVariable, null);
    }

    [Fact]
    public void DisabledHandshakeDoesNotCreateFiles()
    {
        FailureDiagnostics.BeforeFailure("test", "session", _log.Add);
        Assert.Empty(Directory.GetFiles(_directory));
        Assert.Empty(_log);
    }

    [Fact]
    public void MissingSupervisorDirectoryIsReportedWithoutCreatingIt()
    {
        var missing = Path.Join(_directory, "absent");
        FailureDiagnostics.WaitForCapture(missing, "test", null, _log.Add, TimeSpan.FromMilliseconds(50));
        Assert.False(Directory.Exists(missing));
        Assert.Contains(_log, line => line.Contains("handshake failed"));
    }

    [Fact]
    public void ImmediateAtomicAcknowledgementClosesPublicationRace()
    {
        FailureDiagnostics.WaitForCapture(_directory, "test identity", "session identity", _log.Add,
            TimeSpan.FromSeconds(1), request =>
            {
                using var json = JsonDocument.Parse(File.ReadAllText(request));
                var root = json.RootElement;
                var id = root.GetProperty("id").GetString()!;
                Assert.Equal(Guid.ParseExact(id, "N").ToString("N"), id);
                Assert.Equal($"{id}.request.json", Path.GetFileName(request));
                Assert.Equal("test identity", root.GetProperty("test").GetString());
                Assert.Equal("session identity", root.GetProperty("sessionId").GetString());
                Assert.Equal(TimeSpan.FromSeconds(1),
                    root.GetProperty("deadlineUtc").GetDateTimeOffset() - root.GetProperty("failedAtUtc").GetDateTimeOffset());
                Acknowledge(request);
            });
        Assert.Empty(_log);
        Assert.Single(Directory.GetFiles(_directory, "*.request.json"));
    }

    [Fact]
    public void MissingAcknowledgementIsBoundedAndRetainsRequest()
    {
        var timer = Stopwatch.StartNew();
        FailureDiagnostics.WaitForCapture(_directory, "test", null, _log.Add, TimeSpan.FromMilliseconds(50));
        Assert.True(timer.Elapsed < TimeSpan.FromSeconds(2));
        Assert.Contains(_log, line => line.Contains("acknowledgement was not received"));
        Assert.Single(Directory.GetFiles(_directory, "*.request.json"));
    }

    [Fact]
    public async Task FailedScenarioWaitsBeforeCoverageAndDiagnosticsThenRethrowsOriginal()
    {
        Environment.SetEnvironmentVariable(FailureDiagnostics.DirectoryVariable, _directory);
        var artifacts = Path.Join(_directory, "artifacts");
        var observed = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var watcher = new FileSystemWatcher(_directory, "*.request.json");
        watcher.Created += (_, args) => observed.TrySetResult(args.FullPath);
        watcher.Renamed += (_, args) => observed.TrySetResult(args.FullPath);
        watcher.EnableRaisingEvents = true;
        var failure = new InvalidOperationException("original scenario failure");
        var scenario = new FakeDeviceTest(new ListOutput(_log), new FakeSession(artifacts));
        var continuation = Task.Run(() => Assert.Throws<InvalidOperationException>(() => scenario.Execute(() => throw failure)));
        var request = await observed.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(continuation.IsCompleted);
        Assert.False(Directory.Exists(artifacts));
        Acknowledge(request);
        Assert.Same(failure, await continuation.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.Single(Directory.GetFiles(Path.Join(artifacts, "coverage-evidence"), "*-failed.json"));
        Assert.Single(Directory.GetFiles(artifacts, "*-failed-diagnostics-error.txt"));
    }

    [Fact]
    public void HandshakeErrorsPreserveOriginalScenarioException()
    {
        Environment.SetEnvironmentVariable(FailureDiagnostics.DirectoryVariable, Path.Join(_directory, "absent"));
        var failure = new InvalidOperationException("original scenario failure");
        var scenario = new FakeDeviceTest(new ListOutput(_log), new FakeSession(Path.Join(_directory, "artifacts")));
        Assert.Same(failure, Assert.Throws<InvalidOperationException>(() => scenario.Execute(() => throw failure)));
        Assert.Contains(_log, line => line.Contains("handshake failed"));
    }

    [Fact]
    public void OutputErrorsDoNotEscapeTheDiagnosticBoundary()
    {
        FailureDiagnostics.WaitForCapture(Path.Join(_directory, "absent"), "test", null,
            _ => throw new IOException("closed output"), TimeSpan.FromMilliseconds(50));
    }

    private static void Acknowledge(string request)
    {
        var ack = request.Replace(".request.json", ".ack.json", StringComparison.Ordinal);
        File.WriteAllText(ack + ".tmp", "{}");
        File.Move(ack + ".tmp", ack);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable(FailureDiagnostics.DirectoryVariable, _previous);
        Directory.Delete(_directory, true);
    }

    private sealed class ListOutput(List<string> lines) : ITestOutputHelper
    {
        public string Output => string.Join("\n", lines);
        public void Write(string message) => lines.Add(message);
        public void Write(string format, params object[] args) => lines.Add(string.Format(format, args));
        public void WriteLine(string message) => lines.Add(message);
        public void WriteLine(string format, params object[] args) => lines.Add(string.Format(format, args));
    }

    private sealed class FakeSession(string artifacts) : IMobileDeviceSession
    {
        public MobilePlatformAdapter Adapter { get; } = MobilePlatformAdapter.For(MobilePlatform.IOS);
        public MobileTestConfiguration Configuration { get; } = new(MobilePlatform.IOS,
            "/test/app", "test-device", artifacts, new Uri("http://127.0.0.1:4723"));
        public AppiumDriver? Driver => null;
        public void Acquire(IReadOnlyDictionary<string, string>? environment)
        {
            // This fixture exercises failure handling without creating a native device session.
        }
    }

    private sealed class FakeDeviceTest(ITestOutputHelper output, IMobileDeviceSession session)
        : MobileDeviceTest(output, session)
    {
        public void Execute(Action body) => Scenario(body);
    }
}
