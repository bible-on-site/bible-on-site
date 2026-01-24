using System.Diagnostics;
using System.Net.Http;

namespace BibleOnSite.Tests.Fixtures;

/// <summary>
/// xUnit fixture that starts the API server before tests and stops it after.
/// Use with [Collection("ApiServer")] attribute on test classes that need the API.
/// IMPORTANT: Integration tests require the API to run with PROFILE=test (tanah_test database).
/// If an API server is already running with dev profile, tests may fail with unexpected data.
/// </summary>
public class ApiServerFixture : IAsyncLifetime
{
    private Process? _apiProcess;
    private readonly HttpClient _httpClient = new();
    private bool _usingExternalServer;

    public const string ApiUrl = "http://127.0.0.1:3003";
    public const int StartupTimeoutSeconds = 120;
    public const int HealthCheckIntervalMs = 500;

    public async Task InitializeAsync()
    {
        // Set API_URL for tests to use local server (AppConfig.GetApiUrl() reads this)
        Environment.SetEnvironmentVariable("API_URL", ApiUrl);

        // Check if API is already running - DO NOT reuse it!
        // An existing API server may be running with dev database, not test database.
        // Integration tests require the test database (tanah_test) for predictable data.
        if (await IsApiRunning())
        {
            Console.WriteLine("WARNING: API server is already running on port 3003.");
            Console.WriteLine("Integration tests require the API to run with PROFILE=test (uses tanah_test database).");
            Console.WriteLine("Please stop any running 'api: start' task and re-run the tests.");
            Console.WriteLine("The tests will attempt to use the existing server, but may fail if it's using dev data.");

            // Check if we started it ourselves in a previous test run
            if (_apiProcess != null)
            {
                Console.WriteLine("Reusing API server started by this test fixture.");
                return;
            }

            // Mark that we're using an external server we didn't start
            _usingExternalServer = true;
            Console.WriteLine("Using external API server - tests may fail if it's not using test database!");
            return;
        }

        Console.WriteLine("Starting API server with PROFILE=test (uses tanah_test database)...");
        await StartApiServer();
        await WaitForApiReady();
        Console.WriteLine("API server is ready.");
    }

    public async Task DisposeAsync()
    {
        if (_apiProcess != null && !_apiProcess.HasExited)
        {
            Console.WriteLine("Stopping API server...");
            try
            {
                _apiProcess.Kill(entireProcessTree: true);
                await _apiProcess.WaitForExitAsync();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Warning: Error stopping API server: {ex.Message}");
            }
            _apiProcess.Dispose();
        }

        _httpClient.Dispose();
    }

    private async Task<bool> IsApiRunning()
    {
        try
        {
            var response = await _httpClient.GetAsync(ApiUrl);
            // GraphQL endpoint may return various status codes but should respond
            return true;
        }
        catch
        {
            return false;
        }
    }

    private Task StartApiServer()
    {
        var apiDir = FindApiDirectory();
        if (apiDir == null)
        {
            throw new InvalidOperationException("Could not find the API directory (web/api)");
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = "cargo",
            Arguments = "make run-for-tests",
            WorkingDirectory = apiDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        // Set environment for test mode
        startInfo.Environment["PROFILE"] = "test";

        // Forward DB_URL from environment (set by CI or local dev)
        var dbUrl = Environment.GetEnvironmentVariable("DB_URL");
        if (!string.IsNullOrEmpty(dbUrl))
        {
            startInfo.Environment["DB_URL"] = dbUrl;
        }

        _apiProcess = new Process { StartInfo = startInfo };

        _apiProcess.OutputDataReceived += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                Console.WriteLine($"[API] {e.Data}");
            }
        };

        _apiProcess.ErrorDataReceived += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                Console.Error.WriteLine($"[API ERROR] {e.Data}");
            }
        };

        _apiProcess.Start();
        _apiProcess.BeginOutputReadLine();
        _apiProcess.BeginErrorReadLine();

        return Task.CompletedTask;
    }

    private async Task WaitForApiReady()
    {
        var stopwatch = Stopwatch.StartNew();
        var timeout = TimeSpan.FromSeconds(StartupTimeoutSeconds);

        while (stopwatch.Elapsed < timeout)
        {
            if (await IsApiRunning())
            {
                return;
            }

            if (_apiProcess?.HasExited == true)
            {
                throw new InvalidOperationException($"API server process exited unexpectedly with code {_apiProcess.ExitCode}");
            }

            await Task.Delay(HealthCheckIntervalMs);
        }

        throw new TimeoutException($"API server did not start within {StartupTimeoutSeconds} seconds");
    }

    private static string? FindApiDirectory()
    {
        // Try to find the API directory relative to the test project
        var currentDir = Directory.GetCurrentDirectory();

        // Walk up the directory tree to find the repository root
        var dir = new DirectoryInfo(currentDir);
        while (dir != null)
        {
            var apiPath = Path.Combine(dir.FullName, "web", "api");
            if (Directory.Exists(apiPath))
            {
                return apiPath;
            }

            // Also check if we're in the repo root (has bible-on-site.sln)
            var slnPath = Path.Combine(dir.FullName, "bible-on-site.sln");
            if (File.Exists(slnPath))
            {
                apiPath = Path.Combine(dir.FullName, "web", "api");
                if (Directory.Exists(apiPath))
                {
                    return apiPath;
                }
            }

            dir = dir.Parent;
        }

        return null;
    }
}

/// <summary>
/// Collection definition for tests that need the API server.
/// Includes DatabasePopulatorFixture to ensure test data is populated before the API starts.
///
/// Fixture execution order (xUnit guarantees):
/// 1. DatabasePopulatorFixture.InitializeAsync() - Populates test database (if local dev)
/// 2. ApiServerFixture.InitializeAsync() - Starts API server with test profile
/// </summary>
[CollectionDefinition("ApiServer")]
public class ApiServerCollection : ICollectionFixture<DatabasePopulatorFixture>, ICollectionFixture<ApiServerFixture>
{
    // This class has no code, and is never created. Its purpose is simply
    // to be the place to apply [CollectionDefinition] and all the
    // ICollectionFixture<> interfaces.
    //
    // The DatabasePopulatorFixture is listed first to ensure database is populated
    // before ApiServerFixture starts the API server.
}
