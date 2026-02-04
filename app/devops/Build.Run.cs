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

    [Parameter("API environment: dev (local) or prod (remote). Default: dev")]
    readonly string ApiEnv = "dev";

    [Parameter("Force full APK install (embed assemblies). Auto-detected if not set.")]
    readonly bool? FullApk = null;

    [Parameter("Force Fast Deployment (skip embedding). Overrides auto-detection.")]
    readonly bool FastDeploy = false;

    [Parameter("Use dotnet watch for hot reload. Default: false (one-shot build).")]
    readonly bool Watch = false;

    bool IsTestEnv => string.Equals(EnvLevel, "test", StringComparison.OrdinalIgnoreCase);
    bool IsProdApi => string.Equals(ApiEnv, "prod", StringComparison.OrdinalIgnoreCase);

    const string ProdApiUrl = "https://api.xn--febl3a.com";

    string ApiMakeTarget => IsTestEnv ? "test" : "dev";
    string PopulateMakeTarget => IsTestEnv ? "populate-test-db" : "populate-dev-db";

    string AppEnvFile => IsTestEnv ? (RootDirectory / ".test.env") : (RootDirectory / ".dev.env");

    /// <summary>
    /// Writes the API config file for runtime API URL override.
    /// </summary>
    void WriteApiConfigFile()
    {
        var apiConfigPath = System.IO.Path.Combine(SourceDirectory, "Resources", "Raw", "api-config.txt");
        System.IO.File.WriteAllText(apiConfigPath, IsProdApi ? ProdApiUrl : "");
        if (IsProdApi)
        {
            Serilog.Log.Information($"Using production API: {ProdApiUrl}");
        }
    }

    Target PrepareApiConfig => _ => _
        .Description("Prepare API configuration (prod vs dev)")
        .Before(Restore)
        .Executes(() =>
        {
            WriteApiConfigFile();
        });

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

    /// <summary>
    /// Starts the API server in background if not already running.
    /// The API is started as a detached process that will continue running
    /// even after the parent NUKE process exits (e.g., when RunAndroid is closed).
    /// </summary>
    void EnsureApiRunning()
    {
        if (IsApiRunning())
        {
            Serilog.Log.Information("API server already running on port 3003");
            return;
        }

        Serilog.Log.Information("Starting API server in background...");

        var apiPath = ApiDirectory;

        // Start API as a fully detached process that survives parent exit.
        // We use UseShellExecute=true to create a completely independent process
        // that is NOT part of the parent's job object/process tree.
        ProcessStartInfo startInfo;
        if (OperatingSystem.IsWindows())
        {
            // UseShellExecute=true creates a truly independent process on Windows
            // WindowStyle=Hidden keeps it hidden but running independently
            startInfo = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c cargo make {ApiMakeTarget}",
                WorkingDirectory = apiPath,
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
        }
        else
        {
            // On Unix-like systems, use setsid to create a new session (detached process)
            startInfo = new ProcessStartInfo
            {
                FileName = "/bin/bash",
                Arguments = $"-c \"setsid cargo make {ApiMakeTarget} > /dev/null 2>&1 &\"",
                WorkingDirectory = apiPath,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
        }

        // Start the process - don't wait for it since it's meant to run independently
        Process.Start(startInfo);

        // Wait for API to be ready (max 300 seconds)
        Serilog.Log.Information("Waiting for API server to be ready...");
        var timeout = DateTime.Now.AddSeconds(300);
        var attempts = 0;

        while (DateTime.Now < timeout)
        {
            attempts++;

            if (attempts % 4 == 0)
            {
                Serilog.Log.Information($"Still waiting for API... (attempt {attempts})");
            }

            if (IsApiRunning())
            {
                Serilog.Log.Information($"API server started successfully (after ~{attempts * 0.5} seconds)");
                return;
            }

            System.Threading.Thread.Sleep(500);
        }

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

            // Override API_URL if using prod API
            if (IsProdApi)
            {
                Serilog.Log.Information($"Using production API: {ProdApiUrl}");
                Environment.SetEnvironmentVariable("API_URL", ProdApiUrl);
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
        .Description("Run app on Windows. Use --api-env prod for production API")
        .DependsOn(PrepareApiConfig, Compile)
        .Executes(() =>
        {
            // Only start local API if not using prod
            if (!IsProdApi)
            {
                EnsureApiRunning();
            }
            DotNetRun(s => s
                .SetProjectFile(MainProject)
                .SetFramework("net9.0-windows10.0.19041.0")
                .SetConfiguration(Configuration)
                .SetProperty("WindowsPackageType", "None")
                .SetProperty("WindowsAppSDKSelfContained", "false")
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target RunAndroid => _ => _
        .Description("Run app on Android emulator. Options: --full-apk, --fast-deploy, --watch, --api-env prod")
        .DependsOn(PrepareApiConfig)  // Skip CompileAndroid - we do inline build to avoid file locks
        .Executes(() =>
        {
            // Ensure emulator is running
            EnsureAndroidEmulatorRunning();

            // Only start local API if not using prod
            if (!IsProdApi)
            {
                EnsureApiRunning();
            }

            // Determine deployment mode (auto-detect or user override)
            var embedApk = NeedsFullApk();
            var embedArg = embedApk ? "--property:EmbedAssembliesIntoApk=true" : "";

            if (Watch)
            {
                // Clean Android obj so dotnet watch doesn't hit locked dirs (XARDF7024)
                using (var clean = Process.Start(new ProcessStartInfo
                {
                    FileName = "dotnet",
                    Arguments = $"clean \"{MainProject}\" -c {Configuration} -f net9.0-android",
                    WorkingDirectory = RootDirectory,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                }))
                {
                    clean?.WaitForExit(TimeSpan.FromMinutes(1));
                }

                // Use dotnet watch for hot reload support
                // Note: Use --property: instead of -p: because dotnet watch interprets -p as --project
                Serilog.Log.Information($"Starting dotnet watch (embedApk={embedApk})...");
                var watchInfo = new ProcessStartInfo
                {
                    FileName = "dotnet",
                    Arguments = $"watch build -t:Run -f net9.0-android -c {Configuration} {embedArg}".Trim(),
                    WorkingDirectory = SourceDirectory,
                    UseShellExecute = false,
                };

                using var watchProcess = Process.Start(watchInfo);
                watchProcess?.WaitForExit();
                if (watchProcess?.ExitCode != 0)
                {
                    throw new Exception($"Android run failed with exit code {watchProcess?.ExitCode}");
                }
            }
            else
            {
                // One-shot build and install (faster for single iterations)
                // We do the build inline (not via CompileAndroid target) to avoid file lock conflicts
                Serilog.Log.Information($"Building and installing (embedApk={embedApk})...");
                var buildInfo = new ProcessStartInfo
                {
                    FileName = "dotnet",
                    Arguments = $"build -t:Install -f net9.0-android -c {Configuration} {embedArg}".Trim(),
                    WorkingDirectory = SourceDirectory,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };

                using var buildProcess = Process.Start(buildInfo);
                var stdout = buildProcess?.StandardOutput.ReadToEnd() ?? "";
                var stderr = buildProcess?.StandardError.ReadToEnd() ?? "";
                buildProcess?.WaitForExit();

                // Log output
                if (!string.IsNullOrWhiteSpace(stdout))
                {
                    foreach (var line in stdout.Split('\n').Where(l => !string.IsNullOrWhiteSpace(l)))
                    {
                        Serilog.Log.Information(line.TrimEnd());
                    }
                }

                if (buildProcess?.ExitCode != 0)
                {
                    if (!string.IsNullOrWhiteSpace(stderr))
                    {
                        Serilog.Log.Error(stderr);
                    }
                    throw new Exception($"Android build/install failed with exit code {buildProcess?.ExitCode}");
                }

                // Launch and verify the app
                LaunchAndVerifyApp();
            }
        });

    /// <summary>
    /// Checks if the app package is installed on the connected Android device/emulator.
    /// </summary>
    bool IsAppInstalled()
    {
        try
        {
            var adbPath = GetAdbPath();
            var startInfo = new ProcessStartInfo
            {
                FileName = adbPath,
                Arguments = "shell pm list packages com.tanah.daily929",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true,
            };
            using var process = Process.Start(startInfo);
            var output = process?.StandardOutput.ReadToEnd() ?? "";
            process?.WaitForExit();

            return output.Contains("package:com.tanah.daily929");
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Determines if full APK deployment (EmbedAssembliesIntoApk=true) is needed.
    /// Full APK is needed when:
    /// - App is not installed (first deploy or after uninstall/wipe)
    /// - User explicitly requested --full-apk
    /// Fast Deployment is used when:
    /// - User explicitly requested --fast-deploy
    /// - App is already installed (incremental update)
    /// </summary>
    bool NeedsFullApk()
    {
        // User overrides take precedence
        if (FastDeploy)
        {
            Serilog.Log.Information("Fast Deployment forced via --fast-deploy");
            return false;
        }

        if (FullApk == true)
        {
            Serilog.Log.Information("Full APK install forced via --full-apk");
            return true;
        }

        // Auto-detect: check if app is installed
        if (!IsAppInstalled())
        {
            Serilog.Log.Information("App not installed - using full APK install (includes native libs)");
            return true;
        }

        Serilog.Log.Information("App already installed - using Fast Deployment (incremental)");
        return false;
    }

    /// <summary>
    /// Launches the app on the connected Android device/emulator and verifies it's running.
    /// Always force-stops first to ensure fresh launch with new code.
    /// </summary>
    void LaunchAndVerifyApp()
    {
        var adbPath = GetAdbPath();

        // Force stop the app first to ensure fresh launch
        Serilog.Log.Information("Force stopping app...");
        var stopInfo = new ProcessStartInfo
        {
            FileName = adbPath,
            Arguments = "shell am force-stop com.tanah.daily929",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            CreateNoWindow = true,
        };
        using (var stopProcess = Process.Start(stopInfo))
        {
            stopProcess?.WaitForExit();
        }
        System.Threading.Thread.Sleep(500);

        // Launch the app
        Serilog.Log.Information("Launching app...");
        var launchInfo = new ProcessStartInfo
        {
            FileName = adbPath,
            Arguments = "shell monkey -p com.tanah.daily929 -c android.intent.category.LAUNCHER 1",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            CreateNoWindow = true,
        };
        using (var launchProcess = Process.Start(launchInfo))
        {
            launchProcess?.WaitForExit();
        }

        // Wait for app to start
        System.Threading.Thread.Sleep(3000);

        // Verify app is running
        var pidInfo = new ProcessStartInfo
        {
            FileName = adbPath,
            Arguments = "shell pidof com.tanah.daily929",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            CreateNoWindow = true,
        };
        using var pidProcess = Process.Start(pidInfo);
        var pidOutput = pidProcess?.StandardOutput.ReadToEnd()?.Trim() ?? "";
        pidProcess?.WaitForExit();

        if (!string.IsNullOrEmpty(pidOutput))
        {
            Serilog.Log.Information($"App is running (PID {pidOutput})");
        }
        else
        {
            Serilog.Log.Warning("App may have crashed - checking logcat...");

            // Get crash info
            var logcatInfo = new ProcessStartInfo
            {
                FileName = adbPath,
                Arguments = "logcat -d -t 100 --pid=$(pidof com.tanah.daily929) 2>/dev/null || logcat -d -t 100",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true,
            };
            using var logcatProcess = Process.Start(logcatInfo);
            var logcatOutput = logcatProcess?.StandardOutput.ReadToEnd() ?? "";
            logcatProcess?.WaitForExit();

            // Look for crash indicators
            if (logcatOutput.Contains("FATAL") || logcatOutput.Contains("AndroidRuntime") || logcatOutput.Contains("libmonosgen"))
            {
                var crashLines = string.Join("\n",
                    logcatOutput.Split('\n')
                        .Where(l => l.Contains("FATAL") || l.Contains("AndroidRuntime") || l.Contains("Exception") || l.Contains("libmonosgen"))
                        .Take(10));
                Serilog.Log.Error($"App crashed! Relevant logcat:\n{crashLines}");

                if (logcatOutput.Contains("libmonosgen"))
                {
                    Serilog.Log.Information("Tip: Native libs missing - try running with --full-apk");
                }
            }

            throw new Exception("App failed to start or crashed immediately");
        }
    }

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
