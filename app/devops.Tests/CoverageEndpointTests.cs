using AltCover.Recorder;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Xunit;

// The coverage/reset shared-secret lookup. The Android relaunches that drop
// intent extras authorized against a file the app persists under
// FileSystem.AppDataDirectory; the endpoint once read SpecialFolder.Personal,
// which .NET 8 moved under it (files/Documents, dotnet/runtime#102110), so
// every relaunched process found no token and reset refused with 403. These
// tests pin the per-platform directory contract the resolver now follows.
public sealed class CoverageEndpointTests
{
    private const string TokenVariable = "BIBLE_E2E_COVERAGE_TOKEN";
    private const string TokenFileName = "e2e-coverage-token";

    [Fact]
    public void StartupHttpReportsItsCapturedLaunchIdentityAndReaderTransition()
    {
        const string launchId = "736d03cf-bfe6-44cb-a9db-9907194ae2ce";
        var previous = Environment.GetEnvironmentVariable("BIBLE_E2E_LAUNCH_ID");
        try
        {
            Environment.SetEnvironmentVariable("BIBLE_E2E_LAUNCH_ID", launchId.ToUpperInvariant());
            var startup = new StartupState();
            // The launch identity belongs to this process, not later env changes.
            Environment.SetEnvironmentVariable("BIBLE_E2E_LAUNCH_ID", Guid.NewGuid().ToString("D"));
            using var server = new EndpointServer(startup);
            var before = server.Request("GET", "/coverage/startup");
            Assert.Equal(200, before.Status);
            using (var body = JsonDocument.Parse(before.Body))
            {
                Assert.True(body.RootElement.GetProperty("ok").GetBoolean());
                Assert.False(body.RootElement.GetProperty("ready").GetBoolean());
                Assert.Equal(launchId, body.RootElement.GetProperty("launchId").GetString());
                Assert.Equal(3, body.RootElement.EnumerateObject().Count());
            }
            startup.MarkReady();
            startup.MarkReady();
            var after = server.Request("GET", "/coverage/startup");
            Assert.Equal(200, after.Status);
            using var ready = JsonDocument.Parse(after.Body);
            Assert.True(ready.RootElement.GetProperty("ready").GetBoolean());
            Assert.Equal(launchId, ready.RootElement.GetProperty("launchId").GetString());
            Assert.Equal((200, "{\"ok\":true}"), server.Request("GET", "/coverage/health"));
            Assert.Equal(404, server.Request("POST", "/coverage/startup").Status);
        }
        finally
        {
            Environment.SetEnvironmentVariable("BIBLE_E2E_LAUNCH_ID", previous);
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-guid")]
    [InlineData("736d03cfbfe644cba9db9907194ae2ce")]
    [InlineData("{736d03cf-bfe6-44cb-a9db-9907194ae2ce}")]
    [InlineData(" 736d03cf-bfe6-44cb-a9db-9907194ae2ce")]
    [InlineData("736d03cf-bfe6-44cb-a9db-9907194ae2ce\r\n\"ready\":true")]
    public void StartupHttpDoesNotEchoMissingOrMalformedLaunchIdentities(string? launchId)
    {
        var startup = new StartupState(launchId);
        using var server = new EndpointServer(startup);
        var response = server.Request("GET", "/coverage/startup");
        Assert.Equal(200, response.Status);
        using var body = JsonDocument.Parse(response.Body);
        Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("launchId").ValueKind);
        Assert.False(body.RootElement.GetProperty("ready").GetBoolean());
        startup.MarkReady();
        using var ready = JsonDocument.Parse(server.Request("GET", "/coverage/startup").Body);
        Assert.True(ready.RootElement.GetProperty("ready").GetBoolean());
        Assert.Equal(JsonValueKind.Null, ready.RootElement.GetProperty("launchId").ValueKind);
    }

    [Fact]
    public void StartupHttpKeepsLegacyHealthCoverageAndAuthenticatedResetContracts()
    {
        var previous = Environment.GetEnvironmentVariable(TokenVariable);
        try
        {
            Environment.SetEnvironmentVariable(TokenVariable, "http-reset-token");
            var startup = new StartupState(Guid.NewGuid().ToString("D"));
            startup.MarkReady();
            using var server = new EndpointServer(startup);
            Assert.Equal((200, "{\"ok\":true}"), server.Request("GET", "/coverage/health"));
            Instance.Visit("startup-http-contract", 97);
            Assert.Equal(403, server.Request("POST", "/coverage/reset").Status);
            Assert.Equal(403, server.Request("GET", "/coverage/reset", "incorrect-token").Status);
            using (var retained = JsonDocument.Parse(server.Request("GET", "/coverage").Body))
            {
                Assert.Equal(1, retained.RootElement.GetProperty("modules")
                    .GetProperty("startup-http-contract").GetProperty("97").GetInt64());
            }
            Assert.Equal((200, "{\"ok\":true}"), server.Request("POST", "/coverage/reset", "http-reset-token"));
            using (var cleared = JsonDocument.Parse(server.Request("GET", "/coverage").Body))
            {
                Assert.Equal("altcover-visits/1", cleared.RootElement.GetProperty("format").GetString());
                Assert.Empty(cleared.RootElement.GetProperty("modules").GetProperty("startup-http-contract").EnumerateObject());
            }
            using var ready = JsonDocument.Parse(server.Request("GET", "/coverage/startup").Body);
            Assert.True(ready.RootElement.GetProperty("ready").GetBoolean());
            Assert.Equal((200, "{\"ok\":true}"), server.Request("GET", "/coverage/reset", "http-reset-token"));
        }
        finally
        {
            Environment.SetEnvironmentVariable(TokenVariable, previous);
        }
    }

    [Fact]
    public void PublicRecorderSignalReachesTheDefaultStartupHttpState()
    {
        Instance.MarkStartupReady();
        using var server = new EndpointServer();
        var response = server.Request("GET", "/coverage/startup");
        Assert.Equal(200, response.Status);
        using var body = JsonDocument.Parse(response.Body);
        Assert.True(body.RootElement.GetProperty("ready").GetBoolean());
    }

    private sealed class EndpointServer : IDisposable
    {
        private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
        private readonly Thread _thread;

        internal EndpointServer(StartupState? startup = null)
        {
            _listener.Start();
            _thread = new Thread(() => CoverageEndpoint.ServeConnections(_listener, startup)) { IsBackground = true };
            _thread.Start();
        }

        internal (int Status, string Body) Request(string method, string route, string? token = null)
        {
            using var client = new TcpClient { ReceiveTimeout = 1000, SendTimeout = 1000 };
            client.Connect((IPEndPoint)_listener.LocalEndpoint);
            using var stream = client.GetStream();
            var header = token == null ? "" : $"X-Bible-Coverage-Token: {token}\r\n";
            var request = Encoding.ASCII.GetBytes($"{method} {route} HTTP/1.1\r\nHost: localhost\r\n{header}\r\n");
            stream.Write(request);
            using var reader = new StreamReader(stream);
            var response = reader.ReadToEnd();
            var parts = response.Split("\r\n\r\n", 2, StringSplitOptions.None);
            return (int.Parse(parts[0].Split(' ')[1], System.Globalization.CultureInfo.InvariantCulture), parts[1]);
        }

        public void Dispose()
        {
            _listener.Stop();
            _listener.Dispose();
            Assert.True(_thread.Join(1000), "The isolated HTTP listener must stop with its test");
        }
    }

    [Fact]
    public void EnvironmentTokenTakesPrecedenceOverAnyFile()
    {
        var previous = Environment.GetEnvironmentVariable(TokenVariable);
        try
        {
            Environment.SetEnvironmentVariable(TokenVariable, "env-token");
            Assert.Equal("env-token", CoverageEndpoint.RequiredToken());
        }
        finally
        {
            Environment.SetEnvironmentVariable(TokenVariable, previous);
        }
    }

    [Fact]
    public void MissingEnvironmentAndFileReturnsNull()
    {
        var previous = Environment.GetEnvironmentVariable(TokenVariable);
        try
        {
            Environment.SetEnvironmentVariable(TokenVariable, null);
            var directory = CoverageEndpoint.PersistedTokenDirectory();
            // A host that already persists a token legitimately resolves
            // it; the null contract only holds where nothing is configured.
            if (directory != null && File.Exists(Path.Join(directory, TokenFileName)))
            {
                return;
            }
            Assert.Null(CoverageEndpoint.RequiredToken());
        }
        finally
        {
            Environment.SetEnvironmentVariable(TokenVariable, previous);
        }
    }

    [Fact]
    public void DesktopHostResolvesThroughTheDesktopBranch()
    {
        // The RuntimeInformation.IsOSPlatform probes can only report
        // desktop on the test host; pin the glue that does hold — the
        // resolved directory is the desktop branch of the same mapping.
        Assert.Equal(
            CoverageEndpoint.AppDataDirectoryEquivalent("DESKTOP", "ignored-home"),
            CoverageEndpoint.PersistedTokenDirectory());
    }

    [Fact]
    public void AndroidResolvesTheAppFilesDirectory()
    {
        // FileSystem.AppDataDirectory on Android is the app files dir, which
        // the .NET runtime exports as HOME — not its Documents subdirectory.
        var filesDir = "/data/user/0/com.tanah.daily929/files";
        Assert.Equal(filesDir, CoverageEndpoint.AppDataDirectoryEquivalent("ANDROID", filesDir));
        Assert.Null(CoverageEndpoint.AppDataDirectoryEquivalent("ANDROID", null));
    }

    [Fact]
    public void ApplePlatformsResolveTheContainerLibrary()
    {
        var container = "/private/var/mobile/Containers/Data/Application/AAAA-BBBB";
        var expected = Path.Join(container, "Library");
        Assert.Equal(expected, CoverageEndpoint.AppDataDirectoryEquivalent("IOS", container));
        Assert.Equal(expected, CoverageEndpoint.AppDataDirectoryEquivalent("MACCATALYST", container));
        Assert.Equal(expected, CoverageEndpoint.AppDataDirectoryEquivalent("TVOS", container));
        Assert.Equal(expected, CoverageEndpoint.AppDataDirectoryEquivalent("WATCHOS", container));
        Assert.Null(CoverageEndpoint.AppDataDirectoryEquivalent("IOS", null));
    }

    [Fact]
    public void DesktopFallsBackToThePersonalFolder()
    {
        // Suite launches on Windows/desktop always carry the token in the
        // process environment; the file fallback only needs a per-user dir.
        var personal = Environment.GetFolderPath(Environment.SpecialFolder.Personal);
        var expected = string.IsNullOrEmpty(personal) ? null : personal;
        Assert.Equal(expected, CoverageEndpoint.AppDataDirectoryEquivalent("DESKTOP", "/home/x"));
        Assert.Equal(expected, CoverageEndpoint.AppDataDirectoryEquivalent("something-else", null));
    }

    [Fact]
    public void TokenFileLookupReadsTrimsAndRejectsEmpty()
    {
        var directory = Directory.CreateDirectory(
            Path.Join(Path.GetTempPath(), "coverage-endpoint-" + Guid.NewGuid().ToString("N")));
        var path = Path.Join(directory.FullName, TokenFileName);
        try
        {
            Assert.Null(CoverageEndpoint.RequiredTokenFromDirectory(null));
            Assert.Null(CoverageEndpoint.RequiredTokenFromDirectory(directory.FullName));

            File.WriteAllText(path, "   \r\n");
            Assert.Null(CoverageEndpoint.RequiredTokenFromDirectory(directory.FullName));

            File.WriteAllText(path, "  file-token\r\n");
            Assert.Equal("file-token", CoverageEndpoint.RequiredTokenFromDirectory(directory.FullName));
        }
        finally
        {
            directory.Delete(recursive: true);
        }
    }
}
