using System.Diagnostics;
using System.Net.Http;
using System.Net;
using System.Net.Sockets;

namespace BibleOnSite.Tests.Fixtures;

/// <summary>
/// xUnit fixture that starts the API server before tests and stops it after.
/// Use with [Collection("ApiServer")] attribute on test classes that need the API.
/// Integration tests launch their own PROFILE=test API on an available loopback port.
/// The development API on port 3003 can remain running for the emulator.
///
/// NOTE: This fixture ensures the test database is populated before starting the API server.
/// xUnit does NOT guarantee ICollectionFixture initialization order, so we must handle
/// database population directly in this fixture rather than relying on fixture ordering.
/// </summary>
public class ApiServerFixture : IAsyncLifetime
{
    private Process? _apiProcess;
    private readonly HttpClient _httpClient = new();
    private readonly DatabasePopulatorFixture _dbPopulator = new();
    private string? _previousApiUrl;
    private bool _apiUrlOverridden;

    public static string ApiUrl { get; } = $"http://127.0.0.1:{FindAvailablePort()}";
    // A new worktree may need its first Rust build before the API can listen.
    public static int StartupTimeoutSeconds => 600;
    public const int HealthCheckIntervalMs = 500;

    public async Task InitializeAsync()
    {
        // IMPORTANT: Ensure database is populated BEFORE starting the API server.
        // xUnit does not guarantee ICollectionFixture initialization order, so we
        // must call the database populator directly here.
        await _dbPopulator.InitializeAsync();

        // Set API_URL for tests to use local server (AppConfig.GetApiUrl() reads this)
        _previousApiUrl = Environment.GetEnvironmentVariable("API_URL");
        Environment.SetEnvironmentVariable("API_URL", ApiUrl);
        _apiUrlOverridden = true;

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
        if (_apiUrlOverridden)
        {
            Environment.SetEnvironmentVariable("API_URL", _previousApiUrl);
        }
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
            Arguments = "run --locked --profile dev",
            WorkingDirectory = apiDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        // Set environment for test mode
        startInfo.Environment["PROFILE"] = "test";
        startInfo.Environment["PORT"] = new Uri(ApiUrl).Port.ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (OperatingSystem.IsWindows())
        {
            // Windows locks the development API's executable while it is running.
            // Keep this fixture's compiled API separate so tests can rebuild after
            // a version/source change without interrupting the emulator backend.
            startInfo.Environment["CARGO_TARGET_DIR"] = Path.Combine(apiDir, "target", "app-integration");
        }

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

    private static int FindAvailablePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
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

            // Also check if we're in the repo root (has bible-on-site.slnx)
            var slnPath = Path.Combine(dir.FullName, "bible-on-site.slnx");
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
/// The ApiServerFixture internally handles database population before starting the API.
/// </summary>
[CollectionDefinition("ApiServer", DisableParallelization = true)]
public class ApiServerCollection : ICollectionFixture<ApiServerFixture>
{
    // This class has no code, and is never created. Its purpose is simply
    // to be the place to apply [CollectionDefinition] and all the
    // ICollectionFixture<> interfaces.
}
