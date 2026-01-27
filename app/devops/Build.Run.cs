using System;
using System.Diagnostics;
using System.Net.Http;
using System.Net.Sockets;
using Nuke.Common;
using Nuke.Common.IO;
using Nuke.Common.Tools.DotNet;
using static Nuke.Common.Tools.DotNet.DotNetTasks;

partial class Build
{
    [Parameter("Environment level for local runs: dev or test")]
    readonly string EnvLevel = "dev";

    bool IsTestEnv => string.Equals(EnvLevel, "test", StringComparison.OrdinalIgnoreCase);

    string ApiMakeTarget => IsTestEnv ? "test" : "dev";
    string PopulateMakeTarget => IsTestEnv ? "populate-test-db" : "populate-dev-db";

    string AppEnvFile => IsTestEnv ? (RootDirectory / ".test.env") : (RootDirectory / ".dev.env");

    /// <summary>
    /// Checks if API server is running on port 3003.
    /// </summary>
    bool IsApiRunning()
    {
        if (IsPortOpen("127.0.0.1", 3003))
            return true;

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            var response = client.GetAsync("http://localhost:3003").Result;
            return response.IsSuccessStatusCode || response.StatusCode == System.Net.HttpStatusCode.BadRequest;
        }
        catch
        {
            return false;
        }
    }

    static bool IsPortOpen(string host, int port)
    {
        try
        {
            using var client = new TcpClient();
            var connectTask = client.ConnectAsync(host, port);
            return connectTask.Wait(TimeSpan.FromSeconds(1)) && client.Connected;
        }
        catch
        {
            return false;
        }
    }

    Process? _apiProcess;

    /// <summary>
    /// Starts the API server in background if not already running.
    /// </summary>
    void EnsureApiRunning()
    {
        if (IsApiRunning())
        {
            Serilog.Log.Information("API server already running on port 3003");
            return;
        }

        Serilog.Log.Information("Starting API server...");

        var apiPath = ApiDirectory;
        var startInfo = new ProcessStartInfo
        {
            FileName = "cargo",
            Arguments = $"make {ApiMakeTarget}",
            WorkingDirectory = apiPath,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        _apiProcess = new Process { StartInfo = startInfo };

        var lastLogLine = string.Empty;
        var lockObj = new object();

        DataReceivedEventHandler handler = (sender, e) =>
        {
            if (!string.IsNullOrWhiteSpace(e.Data))
            {
                lock (lockObj) lastLogLine = e.Data;
            }
        };

        _apiProcess.OutputDataReceived += handler;
        _apiProcess.ErrorDataReceived += handler;

        _apiProcess.Start();
        _apiProcess.BeginOutputReadLine();
        _apiProcess.BeginErrorReadLine();

        // Wait for API to be ready (max 300 seconds)
        var timeout = DateTime.Now.AddSeconds(300);
        var attempts = 0;

        while (DateTime.Now < timeout)
        {
            attempts++;

            // Log output to console with carriage return to update in-place
            string currentLine;
            lock (lockObj) currentLine = lastLogLine;

            if (!string.IsNullOrEmpty(currentLine))
            {
                try
                {
                    var maxLen = Math.Max(0, Console.WindowWidth - 25);
                    if (currentLine.Length > maxLen) currentLine = currentLine.Substring(0, maxLen) + "...";
                    Console.Write($"\rAPI: {currentLine}".PadRight(Console.WindowWidth - 1));
                }
                catch
                {
                    // Fallback if console manipulation fails
                    if (attempts % 4 == 0) Console.WriteLine($"API: {currentLine}");
                }
            }

            if (IsApiRunning())
            {
                Console.WriteLine(); // Final newline
                Serilog.Log.Information($"API server started successfully (after ~{attempts * 0.5} seconds)");
                return;
            }

            if (_apiProcess.HasExited)
            {
                Console.WriteLine();
                Serilog.Log.Error($"API server process exited unexpectedly with code {_apiProcess.ExitCode}");
                throw new Exception("API server failed to start.");
            }

            System.Threading.Thread.Sleep(500);
        }

        Console.WriteLine();
        Serilog.Log.Warning("API server did not respond within 300 seconds");
    }

    void ApplyAppEnvFile()
    {
        try
        {
            if (!System.IO.File.Exists(AppEnvFile))
                return;

            foreach (var rawLine in System.IO.File.ReadAllLines(AppEnvFile))
            {
                var line = rawLine.Trim();
                if (string.IsNullOrWhiteSpace(line) || line.StartsWith('#'))
                    continue;

                var separatorIndex = line.IndexOf('=');
                if (separatorIndex <= 0)
                    continue;

                var key = line.Substring(0, separatorIndex).Trim();
                var value = line.Substring(separatorIndex + 1).Trim();

                if (!string.IsNullOrEmpty(key))
                {
                    Environment.SetEnvironmentVariable(key, value);
                }
            }
        }
        catch (Exception ex)
        {
            Serilog.Log.Warning($"Failed to load app env file {AppEnvFile}: {ex.Message}");
        }
    }

    Target StartApi => _ => _
        .Description("Start the API server (background)")
        .Executes(() =>
        {
            EnsureApiRunning();
        });

    /// <summary>
    /// Dev target - one command to start everything for local development.
    /// Similar to "npm run dev" or "next dev".
    /// </summary>
    Target Dev => _ => _
        .Description("Start local development environment (API + Windows app)")
        .DependsOn(CompileWindows)
        .Executes(() =>
        {
            EnsureApiRunning();

            DotNetRun(s => s
                .SetProjectFile(MainProject)
                .SetFramework("net9.0-windows10.0.19041.0")
                .SetConfiguration(Configuration)
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target RunWindows => _ => _
        .Description("Run app on Windows (use 'Dev' target for full environment)")
        .DependsOn(Compile)
        .Executes(() =>
        {
            EnsureApiRunning();
            ApplyAppEnvFile();
            DotNetRun(s => s
                .SetProjectFile(MainProject)
                .SetFramework("net9.0-windows10.0.19041.0")
                .SetConfiguration(Configuration)
                .SetProperty("WindowsPackageType", "None")
                .SetProperty("WindowsAppSDKSelfContained", "true")
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target RunAndroid => _ => _
        .Description("Run app on Android emulator (starts emulator and API if needed)")
        .DependsOn(Compile)
        .Executes(() =>
        {
            // Ensure emulator is running
            EnsureAndroidEmulatorRunning();

            // Ensure API is running with dev environment
            EnsureApiRunning();

            ApplyAppEnvFile();

            // Use dotnet watch for hot reload support in VS Code
            // Working directory is set to project folder to avoid --project argument issues
            var startInfo = new ProcessStartInfo
            {
                FileName = "dotnet",
                Arguments = $"watch build -t:Run -f net9.0-android -c {Configuration}",
                WorkingDirectory = SourceDirectory,
                UseShellExecute = false,
            };
            using var process = Process.Start(startInfo);
            process?.WaitForExit();
            if (process?.ExitCode != 0)
            {
                throw new Exception($"Android run failed with exit code {process?.ExitCode}");
            }
        });

    /// <summary>
    /// Checks if an Android device/emulator is connected via ADB.
    /// </summary>
    bool IsAndroidDeviceConnected()
    {
        try
        {
            var adbPath = GetAdbPath();
            var startInfo = new ProcessStartInfo
            {
                FileName = adbPath,
                Arguments = "devices",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true,
            };
            using var process = Process.Start(startInfo);
            var output = process?.StandardOutput.ReadToEnd() ?? "";
            process?.WaitForExit();

            // Check if there's a device listed (not just the header)
            var lines = output.Split('\n', StringSplitOptions.RemoveEmptyEntries);
            return lines.Length > 1 && lines.Any(l => l.Contains("device") && !l.StartsWith("List"));
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Gets the path to the ADB executable.
    /// </summary>
    string GetAdbPath()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return System.IO.Path.Combine(localAppData, "Android", "Sdk", "platform-tools", "adb.exe");
    }

    /// <summary>
    /// Gets the path to the Android emulator executable.
    /// </summary>
    string GetEmulatorPath()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return System.IO.Path.Combine(localAppData, "Android", "Sdk", "emulator", "emulator.exe");
    }

    /// <summary>
    /// Gets the first available Android emulator AVD name.
    /// </summary>
    string? GetFirstAvailableAvd()
    {
        try
        {
            var emulatorPath = GetEmulatorPath();
            var startInfo = new ProcessStartInfo
            {
                FileName = emulatorPath,
                Arguments = "-list-avds",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true,
            };
            using var process = Process.Start(startInfo);
            var output = process?.StandardOutput.ReadToEnd() ?? "";
            process?.WaitForExit();

            var avds = output.Split('\n', StringSplitOptions.RemoveEmptyEntries);
            return avds.FirstOrDefault()?.Trim();
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Ensures an Android emulator is running, starting one if necessary.
    /// </summary>
    void EnsureAndroidEmulatorRunning()
    {
        if (IsAndroidDeviceConnected())
        {
            Serilog.Log.Information("Android device/emulator already connected");
            return;
        }

        var avdName = GetFirstAvailableAvd();
        if (string.IsNullOrEmpty(avdName))
        {
            throw new Exception("No Android emulator AVD found. Please create one using Android Studio.");
        }

        Serilog.Log.Information($"Starting Android emulator: {avdName}");

        var emulatorPath = GetEmulatorPath();
        var startInfo = new ProcessStartInfo
        {
            FileName = emulatorPath,
            Arguments = $"-avd {avdName}",
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        Process.Start(startInfo);

        // Wait for emulator to be ready (up to 120 seconds)
        Serilog.Log.Information("Waiting for emulator to boot...");
        var timeout = TimeSpan.FromSeconds(120);
        var stopwatch = Stopwatch.StartNew();

        while (stopwatch.Elapsed < timeout)
        {
            System.Threading.Thread.Sleep(3000);
            if (IsAndroidDeviceConnected())
            {
                // Wait a bit more for the emulator to fully boot
                System.Threading.Thread.Sleep(5000);
                Serilog.Log.Information("Android emulator is ready");
                return;
            }
        }

        throw new Exception("Timed out waiting for Android emulator to start");
    }

    Target RunIos => _ => _
        .Description("Run app on iOS simulator (starts API if needed)")
        .DependsOn(Compile)
        .Executes(() =>
        {
            // iOS doesn't support dotnet run - use dotnet build -t:Run
            var startInfo = new ProcessStartInfo
            {
                FileName = "dotnet",
                Arguments = $"build \"{MainProject}\" -t:Run -f net9.0-ios -c {Configuration} --no-restore",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var process = Process.Start(startInfo);
            process?.WaitForExit();
            if (process?.ExitCode != 0)
            {
                throw new Exception($"iOS run failed with exit code {process?.ExitCode}");
            }
        });

    Target RunMac => _ => _
        .Description("Run app on Mac Catalyst (starts API if needed)")
        .DependsOn(Compile)
        .Executes(() =>
        {
            // Mac Catalyst doesn't support dotnet run - use dotnet build -t:Run
            var startInfo = new ProcessStartInfo
            {
                FileName = "dotnet",
                Arguments = $"build \"{MainProject}\" -t:Run -f net9.0-maccatalyst -c {Configuration} --no-restore",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var process = Process.Start(startInfo);
            process?.WaitForExit();
            if (process?.ExitCode != 0)
            {
                throw new Exception($"Mac run failed with exit code {process?.ExitCode}");
            }
        });
}
