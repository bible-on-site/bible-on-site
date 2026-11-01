using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;
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
    private readonly string? _previousPort = Environment.GetEnvironmentVariable(FailureDiagnostics.PortVariable);
    private readonly List<string> _log = [];

    public FailureDiagnosticsTests()
    {
        Directory.CreateDirectory(_directory);
        Environment.SetEnvironmentVariable(FailureDiagnostics.DirectoryVariable, null);
        Environment.SetEnvironmentVariable(FailureDiagnostics.PortVariable, null);
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
    public async Task ListeningSupervisorAcknowledgesAtomicPublicationWithoutFilesystemEvents()
    {
        using var supervisor = new Supervisor(_directory, async (id, stream, cancellation) =>
        {
            Acknowledge(Path.Join(_directory, $"{id}.request.json"));
            await ReplyAsync(id, stream, cancellation);
        });
        await StartClient(() => FailureDiagnostics.WaitForCapture(_directory, "test identity", "session identity", _log.Add,
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
                Assert.False(File.Exists(request + ".tmp"));
            }, supervisor.Port));
        await supervisor.Completion.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Empty(_log);
        Assert.Single(Directory.GetFiles(_directory, "*.request.json"));
    }

    [Fact]
    public async Task MissingAcknowledgementIsBoundedAndRetainsRequest()
    {
        using var supervisor = new Supervisor(_directory, async (_, stream, cancellation) =>
        {
            await stream.ReadAsync(new byte[1], cancellation);
        });
        var timer = Stopwatch.StartNew();
        await StartClient(() => FailureDiagnostics.WaitForCapture(_directory, "test", null, _log.Add,
            TimeSpan.FromMilliseconds(50), notificationPort: supervisor.Port));
        Assert.True(timer.Elapsed < TimeSpan.FromSeconds(2));
        Assert.Contains(_log, line => line.Contains("acknowledgement was not received"));
        Assert.Single(Directory.GetFiles(_directory, "*.request.json"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("0")]
    [InlineData("65536")]
    [InlineData("-1")]
    [InlineData("localhost:123")]
    public void InvalidNotificationPortRetainsTheRequestAndReportsFailure(string? port)
    {
        FailureDiagnostics.WaitForCapture(_directory, "test", null, _log.Add,
            TimeSpan.FromMilliseconds(50), notificationPort: port);
        Assert.Contains(_log, line => line.Contains("notification port is missing or invalid"));
        Assert.Single(Directory.GetFiles(_directory, "*.request.json"));
        Assert.Single(Directory.GetFiles(_directory, "*.error.txt"));
    }

    [Theory]
    [InlineData("different")]
    [InlineData("not-retained")]
    [InlineData("closed")]
    [InlineData("extra")]
    public async Task InvalidAcknowledgementCannotCompleteTheHandshake(string failure)
    {
        using var supervisor = new Supervisor(_directory, async (id, stream, cancellation) =>
        {
            if (failure == "closed")
            {
                return;
            }
            if (failure != "not-retained")
            {
                Acknowledge(Path.Join(_directory, $"{id}.request.json"));
            }
            await ReplyAsync(failure == "different" ? new string('0', 32) : id, stream, cancellation);
            if (failure == "extra")
            {
                await stream.WriteAsync(new byte[] { 1 }, cancellation);
            }
        });
        await StartClient(() => FailureDiagnostics.WaitForCapture(_directory, "test", null, _log.Add,
            TimeSpan.FromSeconds(1), notificationPort: supervisor.Port));
        await supervisor.Completion.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Contains(_log, line => line.Contains("handshake failed"));
        Assert.Single(Directory.GetFiles(_directory, "*.error.txt"));
    }

    [Fact]
    public async Task FailedScenarioWaitsBeforeCoverageAndDiagnosticsThenRethrowsOriginal()
    {
        var artifacts = Path.Join(_directory, "artifacts");
        var observed = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var supervisor = new Supervisor(_directory, async (id, stream, cancellation) =>
        {
            var request = Path.Join(_directory, $"{id}.request.json");
            observed.TrySetResult(request);
            await release.Task.WaitAsync(cancellation);
            Acknowledge(request);
            await ReplyAsync(id, stream, cancellation);
        });
        Environment.SetEnvironmentVariable(FailureDiagnostics.DirectoryVariable, _directory);
        Environment.SetEnvironmentVariable(FailureDiagnostics.PortVariable, supervisor.Port);
        var failure = new InvalidOperationException("original scenario failure");
        var scenario = new FakeDeviceTest(new ListOutput(_log), new FakeSession(artifacts));
        var continuation = StartClient(() => Assert.Throws<InvalidOperationException>(() => scenario.Execute(() => throw failure)));
        await observed.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(continuation.IsCompleted);
        Assert.False(Directory.Exists(artifacts));
        release.SetResult();
        Assert.Same(failure, await continuation.WaitAsync(TimeSpan.FromSeconds(5)));
        await supervisor.Completion.WaitAsync(TimeSpan.FromSeconds(5));
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

    [Fact]
    public void DoublyFailedOutputPreservesTheOriginalException()
    {
        Environment.SetEnvironmentVariable(FailureDiagnostics.DirectoryVariable, Path.Join(_directory, "absent"));
        var originalError = Console.Error;
        using var unavailableConsole = new UnavailableConsoleWriter();
        var outputFailures = 0;
        var original = new InvalidOperationException("original scenario failure");
        var output = new ListOutput(_log, _ =>
        {
            outputFailures++;
            throw new IOException("test output unavailable");
        });
        var scenario = new FakeDeviceTest(output, new FakeSession(Path.Join(_directory, "artifacts")));
        try
        {
            Console.SetError(unavailableConsole);
            Assert.Same(original, Assert.Throws<InvalidOperationException>(() => scenario.Execute(() => throw original)));
            Assert.True(outputFailures > 0);
            Assert.True(unavailableConsole.FailedWrites > 0);
        }
        finally
        {
            Console.SetError(originalError);
        }
    }

    [Fact]
    public void OccupiedArtifactPathCannotReplaceTheOriginalScenarioFailure()
    {
        var artifacts = Path.Join(_directory, "artifacts");
        File.WriteAllText(artifacts, "existing file must survive");
        var original = new InvalidOperationException("original scenario failure");
        var scenario = new FakeDeviceTest(new ListOutput(_log), new FakeSession(artifacts));

        Assert.Same(original, Assert.Throws<InvalidOperationException>(() => scenario.Execute(() => throw original)));

        Assert.Equal("existing file must survive", File.ReadAllText(artifacts));
        Assert.Contains(_log, message => message.Contains("Failure diagnostics failed"));
    }
    [Fact]
    public void ArtifactWriteFailureStillFailsAnOtherwisePassingScenario()
    {
        var artifacts = Path.Join(_directory, "artifacts");
        File.WriteAllText(artifacts, "existing file must survive");
        var scenario = new FakeDeviceTest(new ListOutput(_log), new FakeSession(artifacts));

        Assert.ThrowsAny<IOException>(() => scenario.Execute(() =>
        {
            // The scenario succeeds; only writing its evidence is expected to fail.
        }));

        Assert.Equal("existing file must survive", File.ReadAllText(artifacts));
    }
    // The synchronous client must not occupy the pool used by this in-process
    // asynchronous supervisor. Production uses a separate supervisor process.
    private static Task StartClient(Action operation) =>
        Task.Factory.StartNew(operation, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);

    private static Task<T> StartClient<T>(Func<T> operation) =>
        Task.Factory.StartNew(operation, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);

    private static void Acknowledge(string request)
    {
        var ack = request.Replace(".request.json", ".ack.json", StringComparison.Ordinal);
        File.WriteAllText(ack + ".tmp", "{}");
        File.Move(ack + ".tmp", ack);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable(FailureDiagnostics.DirectoryVariable, _previous);
        Environment.SetEnvironmentVariable(FailureDiagnostics.PortVariable, _previousPort);
        Directory.Delete(_directory, true);
    }

    private static ValueTask ReplyAsync(string id, NetworkStream stream, CancellationToken cancellation) =>
        stream.WriteAsync(Encoding.ASCII.GetBytes(id + "\n"), cancellation);

    private sealed class Supervisor : IDisposable
    {
        private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
        private readonly CancellationTokenSource _deadline = new(TimeSpan.FromSeconds(5));
        public string Port { get; }
        public Task Completion { get; }

        public Supervisor(string directory, Func<string, NetworkStream, CancellationToken, Task> receive)
        {
            _listener.Start();
            Port = ((IPEndPoint)_listener.LocalEndpoint).Port.ToString(CultureInfo.InvariantCulture);
            var cancellation = _deadline.Token;
            Completion = ReceiveAsync();
            async Task ReceiveAsync()
            {
                using var client = await _listener.AcceptTcpClientAsync(cancellation).ConfigureAwait(false);
                using var stream = client.GetStream();
                var notification = new byte[33];
                await stream.ReadExactlyAsync(notification, cancellation).ConfigureAwait(false);
                Assert.Equal((byte)'\n', notification[32]);
                var id = Encoding.ASCII.GetString(notification, 0, 32);
                Assert.Matches("^[a-f0-9]{32}$", id);
                Assert.True(File.Exists(Path.Join(directory, $"{id}.request.json")));
                await receive(id, stream, cancellation).ConfigureAwait(false);
            }
        }

        public void Dispose()
        {
            _deadline.Cancel();
            _listener.Stop();
            _deadline.Dispose();
        }
    }

    private sealed class UnavailableConsoleWriter : StringWriter
    {
        public int FailedWrites { get; private set; }
        public override void WriteLine(string? value)
        {
            FailedWrites++;
            throw new IOException($"console error unavailable: {value}");
        }
    }
    private sealed class ListOutput(List<string> lines, Action<string>? beforeWrite = null) : ITestOutputHelper
    {
        public string Output => string.Join("\n", lines);
        public void Write(string message)
        {
            beforeWrite?.Invoke(message);
            lines.Add(message);
        }
        public void Write(string format, params object[] args) => Write(string.Format(format, args));
        public void WriteLine(string message) => Write(message);
        public void WriteLine(string format, params object[] args) => Write(string.Format(format, args));
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
