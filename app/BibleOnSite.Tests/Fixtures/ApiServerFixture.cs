using System.Diagnostics;
using System.Net.Http;

namespace BibleOnSite.Tests.Fixtures;

/// <summary>
/// xUnit fixture that starts the API server before tests and stops it after.
/// Use with [Collection("ApiServer")] attribute on test classes that need the API.
/// </summary>
public class ApiServerFixture : IAsyncLifetime
{
    private Process? _apiProcess;
    private readonly HttpClient _httpClient = new();

    public const string ApiUrl = "http://127.0.0.1:3003";
    public const int StartupTimeoutSeconds = 120;
    public const int HealthCheckIntervalMs = 500;

    public async Task InitializeAsync()
    {
        // TODO: remove me - debug logging
        Console.WriteLine($"[DEBUG] ApiServerFixture.InitializeAsync: Starting...");
        Console.WriteLine($"[DEBUG] ApiServerFixture.InitializeAsync: Current directory = {Directory.GetCurrentDirectory()}");
        Console.WriteLine($"[DEBUG] ApiServerFixture.InitializeAsync: API_URL env before = {Environment.GetEnvironmentVariable("API_URL") ?? "(null)"}");
        Console.WriteLine($"[DEBUG] ApiServerFixture.InitializeAsync: DB_URL env set = {!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("DB_URL"))}");

        // Set API_URL for tests to use local server (AppConfig.GetApiUrl() reads this)
        Environment.SetEnvironmentVariable("API_URL", ApiUrl);
        Console.WriteLine($"[DEBUG] ApiServerFixture.InitializeAsync: Set API_URL to {ApiUrl}");

        // Check if API is already running
        if (await IsApiRunning())
        {
            Console.WriteLine("API server is already running, reusing existing instance.");
            return;
        }

        Console.WriteLine("Starting API server...");
        await StartApiServer();
        Console.WriteLine("[DEBUG] ApiServerFixture.InitializeAsync: StartApiServer completed, waiting for ready...");
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
/// </summary>
[CollectionDefinition("ApiServer")]
public class ApiServerCollection : ICollectionFixture<ApiServerFixture>
{
    // This class has no code, and is never created. Its purpose is simply
    // to be the place to apply [CollectionDefinition] and all the
    // ICollectionFixture<> interfaces.
}
