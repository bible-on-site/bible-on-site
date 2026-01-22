using FlaUI.Core.Conditions;
using System.Diagnostics;
using System.Net.Http;
using System.Net.Sockets;

namespace BibleOnSite.Tests.E2E.Fixtures;

/// <summary>
/// Fixture that manages the application lifecycle for E2E tests.
/// Starts the MAUI Windows app before tests and ensures cleanup after.
/// Also manages the API server dependency - reuses if running, otherwise starts it.
/// </summary>
public class AppFixture : IAsyncLifetime
{
    private Application? _app;
    private UIA3Automation? _automation;
    private Process? _appProcess;
    private Process? _apiProcess;
    private bool _weStartedApi;

    private const string ApiUrl = "http://localhost:3003";

    /// <summary>
    /// The FlaUI Application instance for UI automation.
    /// </summary>
    public Application App => _app ?? throw new InvalidOperationException("App not initialized. Call InitializeAsync first.");

    /// <summary>
    /// The UIA3 automation instance for finding elements.
    /// </summary>
    public UIA3Automation Automation => _automation ?? throw new InvalidOperationException("Automation not initialized.");

    /// <summary>
    /// Gets the main window of the application.
    /// </summary>
    public Window MainWindow => App.GetMainWindow(Automation, TimeSpan.FromSeconds(10));

    /// <summary>
    /// Gets the condition factory for building element queries.
    /// </summary>
    public ConditionFactory CF => Automation.ConditionFactory;

    /// <summary>
    /// Path to the API directory (for starting the API server).
    /// From: app\BibleOnSite.Tests.E2E\bin\Debug\net9.0-windows10.0.19041.0\win-x64\
    /// To:   web\api
    /// </summary>
    private static string ApiDirectory
    {
        get
        {
            var baseDir = Path.GetDirectoryName(typeof(AppFixture).Assembly.Location)
                ?? throw new InvalidOperationException("Cannot determine assembly location");
            // Go up 6 levels (win-x64 -> net9.0... -> Debug -> bin -> BibleOnSite.Tests.E2E -> app) then into web/api
            return Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", "..", "..", "web", "api"));
        }
    }

    /// <summary>
    /// Path to the built MAUI Windows executable.
    /// From: app\BibleOnSite.Tests.E2E\bin\Debug\net9.0-windows10.0.19041.0\win-x64\
    /// To:   app\BibleOnSite\bin\Debug\net9.0-windows10.0.19041.0\win10-x64\
    /// </summary>
    private static string AppPath
    {
        get
        {
            var baseDir = Path.GetDirectoryName(typeof(AppFixture).Assembly.Location)
                ?? throw new InvalidOperationException("Cannot determine assembly location");

            // Navigate from test output to app output (go up to app/, then into BibleOnSite/bin/...)
            var appDir = Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", "..", "BibleOnSite", "bin", "Debug", "net9.0-windows10.0.19041.0", "win10-x64"));
            var exePath = Path.Combine(appDir, "BibleOnSite.exe");

            if (!File.Exists(exePath))
            {
                throw new FileNotFoundException(
                    $"App executable not found at {exePath}. " +
                    "Make sure to build the app first: dotnet build BibleOnSite/BibleOnSite.csproj -f net9.0-windows10.0.19041.0");
            }

            return exePath;
        }
    }

    /// <summary>
    /// Checks if the API server is running by checking if the port is open.
    /// </summary>
    private static bool IsApiRunning()
    {
        try
        {
            // First check if port is open with TCP
            using var tcpClient = new TcpClient();
            var connectTask = tcpClient.ConnectAsync("127.0.0.1", 3003);
            if (!connectTask.Wait(TimeSpan.FromSeconds(2)))
            {
                Console.WriteLine("API check failed: TCP connection timed out");
                return false;
            }

            if (!tcpClient.Connected)
            {
                Console.WriteLine("API check failed: TCP connection refused");
                return false;
            }

            Console.WriteLine("API is responding on port 3003");
            return true;
        }
        catch (Exception ex)
        {
            var innerMessage = ex.InnerException?.Message ?? ex.Message;
            Console.WriteLine($"API check failed: {innerMessage}");
            return false;
        }
    }

    /// <summary>
    /// Ensures the API server is running. Reuses if already running, otherwise starts it.
    /// </summary>
    private async Task EnsureApiRunningAsync()
    {
        if (IsApiRunning())
        {
            Console.WriteLine("API server already running on port 3003 - reusing");
            _weStartedApi = false;
            return;
        }

        Console.WriteLine($"Starting API server from {ApiDirectory}...");
        _weStartedApi = true;

        // Use cmd.exe /c to run cargo make in a shell context (ensures PATH is available)
        var startInfo = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/c cargo make run-api-test",
            WorkingDirectory = ApiDirectory,
            UseShellExecute = true,
            CreateNoWindow = false,
        };

        _apiProcess = Process.Start(startInfo);
        if (_apiProcess == null)
        {
            throw new InvalidOperationException("Failed to start API server process");
        }

        // Wait for API to be ready (max 120 seconds - Rust compilation can take a while)
        var timeout = DateTime.Now.AddSeconds(120);
        var attempts = 0;
        while (DateTime.Now < timeout)
        {
            attempts++;
            await Task.Delay(2000);
            if (IsApiRunning())
            {
                Console.WriteLine($"API server started successfully (after ~{attempts * 2} seconds)");
                return;
            }
            if (attempts % 10 == 0)
            {
                Console.WriteLine($"Still waiting for API... ({attempts * 2}s elapsed)");
            }
        }

        throw new InvalidOperationException("API server did not respond within 120 seconds");
    }

    public async Task InitializeAsync()
    {
        _automation = new UIA3Automation();

        // Ensure API is running first (reuse if already running)
        await EnsureApiRunningAsync();

        // Start the application
        var startInfo = new ProcessStartInfo
        {
            FileName = AppPath,
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(AppPath)
        };

        _app = Application.Launch(startInfo);
        _appProcess = Process.GetProcessById(_app.ProcessId);

        if (_appProcess == null)
        {
            throw new InvalidOperationException("Failed to start the application");
        }

        // Wait for the app to start and get the Application instance
        await Task.Delay(3000); // Give app time to initialize

        // Wait for main window to be available (startup can be slow on first run)
        var timeout = DateTime.UtcNow.AddSeconds(60);
        Exception? lastException = null;
        while (DateTime.UtcNow < timeout)
        {
            if (_appProcess.HasExited)
            {
                throw new InvalidOperationException($"App process exited before window was available. Exit code: {_appProcess.ExitCode}");
            }

            try
            {
                var window = App.GetMainWindow(Automation, TimeSpan.FromSeconds(5));
                if (window != null)
                {
                    return;
                }
            }
            catch (Exception ex)
            {
                lastException = ex;
            }

            await Task.Delay(500);
        }

        throw new InvalidOperationException(
            "Main window not found after 60 seconds.",
            lastException);
    }

    public async Task DisposeAsync()
    {
        try
        {
            _app?.Close();
            await Task.Delay(500);

            if (_appProcess != null && !_appProcess.HasExited)
            {
                _appProcess.Kill();
                await _appProcess.WaitForExitAsync();
            }

            // Only stop API if we started it
            if (_weStartedApi && _apiProcess != null && !_apiProcess.HasExited)
            {
                Console.WriteLine("Stopping API server (we started it)...");
                _apiProcess.Kill();
                await _apiProcess.WaitForExitAsync();
            }
        }
        catch
        {
            // Ignore cleanup errors
        }
        finally
        {
            _automation?.Dispose();
            _appProcess?.Dispose();
            _apiProcess?.Dispose();
        }
    }

    /// <summary>
    /// Waits for an element to appear in the UI.
    /// </summary>
    public async Task<AutomationElement?> WaitForElementAsync(
        Func<Window, AutomationElement?> finder,
        TimeSpan? timeout = null)
    {
        timeout ??= TimeSpan.FromSeconds(10);
        var sw = Stopwatch.StartNew();

        while (sw.Elapsed < timeout)
        {
            var element = finder(MainWindow);
            if (element != null)
            {
                return element;
            }
            await Task.Delay(100);
        }

        return null;
    }

    /// <summary>
    /// Finds an element by its automation ID.
    /// </summary>
    public AutomationElement? FindByAutomationId(string automationId)
    {
        return MainWindow.FindFirstDescendant(CF.ByAutomationId(automationId));
    }

    /// <summary>
    /// Finds an element by its name.
    /// </summary>
    public AutomationElement? FindByName(string name)
    {
        return MainWindow.FindFirstDescendant(CF.ByName(name));
    }

    /// <summary>
    /// Finds a button by its text content.
    /// </summary>
    public Button? FindButton(string text)
    {
        var element = MainWindow.FindFirstDescendant(CF.ByName(text));
        return element?.AsButton();
    }
}
