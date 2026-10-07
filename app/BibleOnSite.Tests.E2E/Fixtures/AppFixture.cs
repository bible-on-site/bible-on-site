using FlaUI.Core.Conditions;
using System.Diagnostics;
using System.Net.Http;
using System.Net.Sockets;
using System.Drawing;
using System.Runtime.InteropServices;
using FlaUI.Core.Input;
using FlaUI.Core.WindowsAPI;

namespace BibleOnSite.Tests.E2E.Fixtures;

/// <summary>
/// Fixture that manages the application lifecycle for E2E tests.
/// Starts the MAUI Windows app before tests and ensures cleanup after.
/// Also manages the API server dependency - reuses if running, otherwise starts it.
/// </summary>
public class AppFixture : IAsyncLifetime
{
    protected virtual bool RequiresApi => true;
    private Application? _app;
    private UIA3Automation? _automation;
    private Process? _appProcess;
    private Process? _apiProcess;
    private bool _weStartedApi;
    private DateTime _apiStartedAt;

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
    public Window MainWindow => App.GetMainWindow(Automation, TimeSpan.FromSeconds(10))
        ?? throw new InvalidOperationException("Main window not found within timeout.");

    /// <summary>
    /// Gets the condition factory for building element queries.
    /// </summary>
    public ConditionFactory CF => Automation.ConditionFactory;

    /// <summary>
    /// Path to the API directory (for starting the API server).
    /// From: app\BibleOnSite.Tests.E2E\bin\Debug\net10.0-windows10.0.19041.0\win-x64\
    /// To:   web\api
    /// </summary>
    private static string ApiDirectory
    {
        get
        {
            var baseDir = Path.GetDirectoryName(typeof(AppFixture).Assembly.Location)
                ?? throw new InvalidOperationException("Cannot determine assembly location");
            // Go up 6 levels (win-x64 -> net10.0... -> Debug -> bin -> BibleOnSite.Tests.E2E -> app) then into web/api
            return Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", "..", "..", "web", "api"));
        }
    }

    /// <summary>
    /// Path to the built MAUI Windows executable.
    /// From: app\BibleOnSite.Tests.E2E\bin\Debug\net10.0-windows10.0.19041.0\win-x64\
    /// To:   app\BibleOnSite\bin\Debug\net10.0-windows10.0.19041.0\win-x64\
    /// </summary>
    private static string AppPath
    {
        get
        {
            var baseDir = Path.GetDirectoryName(typeof(AppFixture).Assembly.Location)
                ?? throw new InvalidOperationException("Cannot determine assembly location");

            // Navigate from test output to app output (go up to app/, then into BibleOnSite/bin/...)
            var appDir = Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", "..", "BibleOnSite", "bin", "Debug", "net10.0-windows10.0.19041.0", "win-x64"));
            var exePath = Path.Combine(appDir, "BibleOnSite.exe");

            if (!File.Exists(exePath))
            {
                throw new FileNotFoundException(
                    $"App executable not found at {exePath}. " +
                    "Make sure to build the app first: dotnet build BibleOnSite/BibleOnSite.csproj -f net10.0-windows10.0.19041.0");
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
        _apiStartedAt = DateTime.UtcNow;

        // Launch the API directly; the inherited PATH locates Cargo.
        var startInfo = new ProcessStartInfo
        {
            FileName = "cargo",
            Arguments = "run --locked",
            WorkingDirectory = ApiDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };

        startInfo.Environment["PROFILE"] = "test";
        _apiProcess = Process.Start(startInfo);
        if (_apiProcess == null)
        {
            throw new InvalidOperationException("Failed to start API server process");
        }

        // A new worktree may need its first Rust build before the API can listen.
        var timeout = DateTime.Now.AddSeconds(600);
        var attempts = 0;
        while (DateTime.Now < timeout)
        {
            attempts++;
            await Task.Delay(2000);
            if (_apiProcess.HasExited) throw new InvalidOperationException("API process exited before becoming ready");
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

        throw new InvalidOperationException("API server did not respond within 600 seconds");
    }

    public async Task InitializeAsync()
    {
        SetProcessDPIAware();
        _automation = new UIA3Automation();

        // Ensure API is running first (reuse if already running)
        if (RequiresApi) await EnsureApiRunningAsync();

        // Only clean up this checkout's test app, never another running checkout.
        foreach (var proc in Process.GetProcessesByName("BibleOnSite"))
        {
            try
            {
                if (string.Equals(proc.MainModule?.FileName, AppPath, StringComparison.OrdinalIgnoreCase))
                { proc.Kill(); proc.WaitForExit(2000); }
            }
            catch { /* A process that exits during enumeration needs no further cleanup. */ }
        }
        await Task.Delay(1000); // Give time for processes to fully terminate

        // Start the application using dotnet run (which handles Windows App SDK properly)
        var projectDir = Path.GetFullPath(Path.Combine(AppPath, "..", "..", "..", "..", "..")); // Go up to BibleOnSite project folder
        var startInfo = new ProcessStartInfo
        {
            FileName = "dotnet",
            Arguments = "run -f net10.0-windows10.0.19041.0 --no-build",
            WorkingDirectory = projectDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = false,
            RedirectStandardError = false,
        };

        // Offline fixtures use a closed endpoint even when a development API is running.
        var launchApiUrl = RequiresApi ? ApiUrl : "http://127.0.0.1:1";
        startInfo.EnvironmentVariables["API_URL"] = launchApiUrl;

        Console.WriteLine($"Starting app from {projectDir} with API_URL={launchApiUrl}");

        _appProcess = Process.Start(startInfo);

        if (_appProcess == null)
        {
            throw new InvalidOperationException("Failed to start dotnet run process");
        }

        // Wait for the app to start and initialize
        await Task.Delay(8000); // Give app more time to compile if needed and fully initialize

        // Find the actual BibleOnSite.exe process that dotnet run started
        Process? targetProcess = null;
        var processes = Process.GetProcessesByName("BibleOnSite");

        Console.WriteLine($"Found {processes.Length} BibleOnSite processes");

        foreach (var proc in processes)
        {
            try
            {
                proc.Refresh();
                if (!string.Equals(proc.MainModule?.FileName, AppPath, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (proc.MainWindowHandle != IntPtr.Zero)
                {
                    Console.WriteLine($"Process {proc.Id} has a main window");
                    targetProcess = proc;
                    break;
                }
            }
            catch
            {
                // Skip processes that can't be queried
            }
        }

        // If no process with window found, try to use the first one that hasn't exited
        if (targetProcess == null)
        {
            foreach (var proc in processes)
            {
                try
                {
                    proc.Refresh();
                    if (!string.Equals(proc.MainModule?.FileName, AppPath, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    if (!proc.HasExited)
                    {
                        Console.WriteLine($"Using process {proc.Id} (no window handle but still running)");
                        targetProcess = proc;
                        break;
                    }
                }
                catch
                {
                    // Skip
                }
            }
        }

        if (targetProcess == null)
        {
            throw new InvalidOperationException("BibleOnSite process not found after startup");
        }

        // Attach FlaUI to the BibleOnSite process (not the dotnet process)
        _app = Application.Attach(targetProcess.Id);

        // Wait for main window to be available (startup can be slow on first run)
        var timeout = DateTime.UtcNow.AddSeconds(60);
        Exception? lastException = null;
        while (DateTime.UtcNow < timeout)
        {
            try
            {
                targetProcess.Refresh();
                if (targetProcess.HasExited)
                {
                    throw new InvalidOperationException("App process exited before window was available.");
                }
            }
            catch (InvalidOperationException)
            {
                throw;
            }
            catch
            {
                // Ignore Refresh errors
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
                _appProcess.Kill(entireProcessTree: true);
                await _appProcess.WaitForExitAsync();
            }

            // Only stop API if we started it
            if (_weStartedApi && _apiProcess != null && !_apiProcess.HasExited)
            {
                Console.WriteLine("Stopping API server (we started it)...");
                _apiProcess.Kill(entireProcessTree: true);
                await _apiProcess.WaitForExitAsync();
            }
            // Cargo can detach its API child before the launcher exits.
            if (_weStartedApi)
            {
                var executable = Path.Combine(ApiDirectory, "target", "debug", "api.exe");
                foreach (var process in Process.GetProcessesByName("api"))
                {
                    using (process)
                    {
                        try
                        {
                            if (process.StartTime.ToUniversalTime() >= _apiStartedAt &&
                                string.Equals(process.MainModule?.FileName, executable, StringComparison.OrdinalIgnoreCase))
                            { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); }
                        }
                        catch (InvalidOperationException) { /* The owned API process exited during cleanup. */ }
                    }
                }
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

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    private void AssertOwnedWindow(IntPtr window)
    {
        GetWindowThreadProcessId(window, out var processId);
        if (processId != App.ProcessId)
        {
            throw new InvalidOperationException("Native gesture tests require an isolated desktop with BibleOnSite in the foreground. No input was sent.");
        }
    }

    public void AssertForeground() => AssertOwnedWindow(GetForegroundWindow());

    /// <summary>Fail before synthetic input if another app covers the test window.</summary>
    public void Click(AutomationElement element) => Click(element, MouseButton.Left, false);
    public void Click(AutomationElement element, MouseButton button) => Click(element, button, false);
    public void Click(AutomationElement element, bool doubleClick) => Click(element, MouseButton.Left, doubleClick);

    public void Click(AutomationElement element, MouseButton button, bool doubleClick)
    {
        AssertForeground();
        Point point;
        try { point = element.GetClickablePoint(); }
        catch (FlaUI.Core.Exceptions.NoClickablePointException) when (!element.IsOffscreen && element.BoundingRectangle.Width > 0 && element.BoundingRectangle.Height > 0)
        {
            // WinUI text inside CollectionView items may omit the clickable-point provider.
            var bounds = element.BoundingRectangle;
            point = new Point((int)(bounds.Left + bounds.Width / 2), (int)(bounds.Top + bounds.Height / 2));
        }
        AssertOwnedWindow(WindowFromPoint(point));
        if (doubleClick)
        {
            Mouse.DoubleClick(point);
        }
        else
        {
            Mouse.Click(point, button);
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
            try
            {
                var element = finder(MainWindow);
                if (element != null)
                {
                    return element;
                }
            }
            catch (COMException ex) when (ex.HResult == unchecked((int)0x80131505))
            {
                // WinUI can briefly time out while its first visual tree is being built.
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
