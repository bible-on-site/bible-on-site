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
        var apiConfigPath = System.IO.Path.Join(SourceDirectory, "Resources", "Raw", "api-config.txt");
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
        {
            return true;
        }

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            var response = client.GetAsync("http://localhost:3003").Result;
            return response.IsSuccessStatusCode || response.StatusCode == System.Net.HttpStatusCode.BadRequest;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: API probe: any failure counts as not-running
        catch //NOSONAR — API probe: any failure counts as not-running.
        {
            #pragma warning restore S2221
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
        #pragma warning disable S2221 // Deliberate failure boundary: TCP probe: any failure counts as closed
        catch //NOSONAR — TCP probe: any failure counts as closed.
        {
            #pragma warning restore S2221
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
        var startInfo = OperatingSystem.IsWindows()
            // UseShellExecute=true creates a truly independent process on Windows
            // WindowStyle=Hidden keeps it hidden but running independently
            ? new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c cargo make {ApiMakeTarget}",
                WorkingDirectory = apiPath,
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            }
            // On Unix-like systems, use setsid to create a new session (detached process)
            : new ProcessStartInfo
            {
                FileName = "/bin/bash",
                Arguments = $"-c \"setsid cargo make {ApiMakeTarget} > /dev/null 2>&1 &\"",
                WorkingDirectory = apiPath,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

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
            {
                return;
            }

            foreach (var line in System.IO.File.ReadAllLines(AppEnvFile)
                .Select(rawLine => rawLine.Trim())
                .Where(line => !string.IsNullOrWhiteSpace(line) && !line.StartsWith('#')))
            {
                var separatorIndex = line.IndexOf('=');
                if (separatorIndex <= 0)
                {
                    continue;
                }

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
        #pragma warning disable S2221 // Deliberate failure boundary: env-file load failure warns and continues with defaults
        catch (Exception ex) //NOSONAR — env-file load failure warns and continues with defaults.
        {
            #pragma warning restore S2221
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
    /// Ensures Docker MinIO container is running for S3 access.
    /// </summary>
    void EnsureMinioRunning()
    {
        var devopsDir = RootDirectory.Parent / "devops";
        var composeFile = devopsDir / "docker-compose.yml";

        Serilog.Log.Information("Ensuring MinIO is running...");
        var startInfo = new ProcessStartInfo
        {
            FileName = "docker",
            Arguments = $"compose -f \"{composeFile}\" up -d minio",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        using var process = Process.Start(startInfo);
        process?.WaitForExit();

        if (process?.ExitCode == 0)
        {
            Serilog.Log.Information("MinIO is running");
        }
        else
        {
            Serilog.Log.Warning("Failed to start MinIO - S3 resources may not be available");
        }
    }

    /// <summary>
    /// Dev target - one command to start everything for local development.
    /// Similar to "bun run dev" or "next dev".
    /// </summary>
    Target Dev => _ => _
        .Description("Start local development environment (API + Windows app)")
        .DependsOn(PrepareWindowsRecitation, CompileWindows)
        .Executes(() =>
        {
            EnsureMinioRunning();
            EnsureApiRunning();

            DotNetRun(s => s
                .SetProjectFile(MainProject)
                .SetFramework("net11.0-windows10.0.19041.0")
                .SetConfiguration(Configuration)
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target RunWindows => _ => _
        .Description("Run app on Windows. Use --api-env prod for production API")
        .DependsOn(PrepareApiConfig, PrepareWindowsRecitation, Compile)
        .Executes(() =>
        {
            EnsureMinioRunning();
            // Only start local API if not using prod
            if (!IsProdApi)
            {
                EnsureApiRunning();
            }
            DotNetRun(s => s
                .SetProjectFile(MainProject)
                .SetFramework("net11.0-windows10.0.19041.0")
                .SetConfiguration(Configuration)
                .SetProperty("WindowsPackageType", "None")
                .SetProperty("WindowsAppSDKSelfContained", "false")
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target RunAndroid => _ => _
        .Description("Run app on Android emulator. Options: --full-apk, --fast-deploy, --watch, --api-env prod")
        .DependsOn(PrepareApiConfig, PrepareAndroidRecitation)  // Inline build avoids file locks.
        .Executes(() =>
        {
            // Ensure emulator is running
            EnsureAndroidEmulatorRunning();
            EnsureMinioRunning();

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
                    Arguments = $"clean \"{MainProject}\" -c {Configuration} -f net11.0-android",
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
                    Arguments = $"watch build -t:Run -f net11.0-android -c {Configuration} {embedArg}".Trim(),
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
                    Arguments = $"build -t:Install -f net11.0-android -c {Configuration} {embedArg}".Trim(),
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

                // Ensure perushim databases are on the device.
                // PAD doesn't work in debug/emulator, so we push via ADB if missing.
                EnsurePerushimOnDevice();

                // Launch and verify the app
                LaunchAndVerifyApp();
            }
        });

    /// <summary>
    /// Runs adb with the shared flags, waits for exit, and returns stdout,
    /// stderr (when requested) and the exit code.
    /// </summary>
    (string Output, string Error, int ExitCode) RunAdb(string[] arguments, bool readStderr = false)
    {
        // ArgumentList bypasses shell parsing on the host side entirely.
        var startInfo = new ProcessStartInfo(GetAdbPath())
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = readStderr,
            CreateNoWindow = true,
        };
        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }
        // The static Process.Start(startInfo) shape is Semgrep's
        // command-injection sink; starting an instance is equivalent.
        using var process = new Process { StartInfo = startInfo }; // nosemgrep — closed argv, literal filename, no shell
        process.Start();
        var output = process.StandardOutput.ReadToEnd();
        var error = readStderr ? process.StandardError.ReadToEnd() : "";
        process.WaitForExit();
        return (output, error, process.ExitCode);
    }

    /// <summary>
    /// Checks if the app package is installed on the connected Android emulator.
    /// </summary>
    bool IsAppInstalled()
    {
        try
        {
            var (output, _, _) = RunAdb(GetAdbDeviceArgs("shell", "pm", "list", "packages", "com.tanah.daily929"));
            return output.Contains("package:com.tanah.daily929");
        }
        #pragma warning disable S2221 // Deliberate failure boundary: adb package probe: any failure counts as not-installed
        catch //NOSONAR — adb package probe: any failure counts as not-installed.
        {
            #pragma warning restore S2221
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
    /// Launches the app on the connected Android emulator and verifies it's running.
    /// Always force-stops first to ensure fresh launch with new code.
    /// </summary>
    void LaunchAndVerifyApp()
    {
        // Force stop the app first to ensure fresh launch
        Serilog.Log.Information("Force stopping app...");
        RunAdb(GetAdbDeviceArgs("shell", "am", "force-stop", "com.tanah.daily929"));
        System.Threading.Thread.Sleep(500);

        // Launch the app
        Serilog.Log.Information("Launching app...");
        RunAdb(GetAdbDeviceArgs("shell", "monkey", "-p", "com.tanah.daily929", "-c", "android.intent.category.LAUNCHER", "1"));

        // Wait for app to start
        System.Threading.Thread.Sleep(3000);

        // Verify app is running
        var (pidOutput, _, _) = RunAdb(GetAdbDeviceArgs("shell", "pidof", "com.tanah.daily929"));
        pidOutput = pidOutput.Trim();

        if (!string.IsNullOrEmpty(pidOutput))
        {
            Serilog.Log.Information($"App is running (PID {pidOutput})");
        }
        else
        {
            Serilog.Log.Warning("App may have crashed - checking logcat...");

            // Get crash info
            var (logcatOutput, _, _) = RunAdb(GetAdbDeviceArgs("logcat", "-d", "-t", "100"));

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
            var lines = GetAdbDeviceLines();
            return lines.Length > 1 && lines.Any(l => l.Contains("device") && !l.StartsWith("List"));
        }
        #pragma warning disable S2221 // Deliberate failure boundary: adb device probe: any failure counts as no-device
        catch //NOSONAR — adb device probe: any failure counts as no-device.
        {
            #pragma warning restore S2221
            return false;
        }
    }

    /// <summary>
    /// Gets the path to the ADB executable.
    /// </summary>
    string GetAdbPath()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return System.IO.Path.Join(localAppData, "Android", "Sdk", "platform-tools", "adb.exe");
    }

    /// <summary>
    /// Gets the serial number of the first connected emulator.
    /// Returns null if no emulator is found.
    /// </summary>
    string? GetEmulatorSerial()
    {
        try
        {
            // Find emulator line (starts with "emulator-")
            return GetAdbDeviceLines()
                .Where(trimmed => trimmed.StartsWith("emulator-") && trimmed.Contains("device"))
                .Select(trimmed => trimmed.Split('\t')[0].Trim())
                .FirstOrDefault();
        }
        #pragma warning disable S2221 // Deliberate failure boundary: adb id probe: any failure counts as absent
        catch //NOSONAR — adb id probe: any failure counts as absent.
        {
            #pragma warning restore S2221
            return null;
        }
    }

    /// <summary>
    /// Returns trimmed, non-empty lines of `adb devices` output (header included).
    /// </summary>
    string[] GetAdbDeviceLines()
    {
        var (output, _, _) = RunAdb(["devices"]);
        return output.Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim())
            .ToArray();
    }

    /// <summary>
    /// Gets ADB arguments with device selector if multiple devices are connected.
    /// </summary>
    string[] GetAdbDeviceArgs(params string[] command)
    {
        var emulatorSerial = GetEmulatorSerial();
        if (emulatorSerial != null)
        {
            return new[] { "-s", emulatorSerial }.Concat(command).ToArray();
        }
        return command;
    }

    /// <summary>
    /// Gets the path to the Android emulator executable.
    /// </summary>
    string GetEmulatorPath()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return System.IO.Path.Join(localAppData, "Android", "Sdk", "emulator", "emulator.exe");
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
        #pragma warning disable S2221 // Deliberate failure boundary: avd probe: any failure counts as none
        catch //NOSONAR — avd probe: any failure counts as none.
        {
            #pragma warning restore S2221
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

    const string AppId = "com.tanah.daily929";
    const string NotesDbName = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";
    const string CatalogDbName = "sefaria-dump-5784-sivan-4.perushim_catalog.sqlite";

    /// <summary>
    /// Checks whether a file exists in the app's data directory on the device.
    /// </summary>
    bool DeviceFileExists(string fileName)
    {
        try
        {
            var (_, _, exitCode) = RunAdb(GetAdbDeviceArgs("shell", "run-as", AppId, "ls", $"files/{fileName}"), readStderr: true);
            return exitCode == 0;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: adb push probe: any failure counts as failed
        catch { return false; } //NOSONAR — adb push probe: any failure counts as failed.
        #pragma warning restore S2221
    }

    /// <summary>
    /// Pushes a local file to the app's data directory on the device.
    /// Uses /data/local/tmp/ as a staging area since adb push can't write to app-private dirs.
    /// </summary>
    void PushFileToDevice(string localPath, string fileName)
    {
        var tmpPath = $"/data/local/tmp/{fileName}";

        // Step 1: push to staging area
        Serilog.Log.Information($"Pushing {fileName} to device ({new System.IO.FileInfo(localPath).Length / (1024 * 1024)} MB)...");
        var (_, pushError, pushExit) = RunAdb(GetAdbDeviceArgs("push", localPath, tmpPath), readStderr: true);
        if (pushExit != 0)
        {
            Serilog.Log.Warning($"adb push failed: {pushError}");
            return;
        }

        // Step 2: copy from staging into app data via run-as
        var (_, cpError, cpExit) = RunAdb(GetAdbDeviceArgs("shell", "run-as", AppId, "cp", tmpPath, $"/data/data/{AppId}/files/{fileName}"), readStderr: true);
        if (cpExit != 0)
        {
            Serilog.Log.Warning($"run-as cp failed: {cpError}");
            return;
        }

        // Step 3: clean up staging
        RunAdb(GetAdbDeviceArgs("shell", "rm", "-f", tmpPath));

        Serilog.Log.Information($"Pushed {fileName} to device");
    }

    /// <summary>
    /// Ensures the perushim notes and catalog databases exist on the device.
    /// PAD (Play Asset Delivery) doesn't work in debug/emulator mode, so we
    /// push the databases directly via ADB if they're missing on the device.
    /// </summary>
    void EnsurePerushimOnDevice()
    {
        // Notes DB: lives in asset pack dir locally, push if missing from device
        var notesLocalPath = System.IO.Path.Join(
            SourceDirectory, "Platforms", "Android", "AssetPacks", "perushim_notes", NotesDbName);

        if (System.IO.File.Exists(notesLocalPath) && !DeviceFileExists(NotesDbName))
        {
            PushFileToDevice(notesLocalPath, NotesDbName);
        }
        else if (!System.IO.File.Exists(notesLocalPath))
        {
            Serilog.Log.Warning($"Perushim notes not found at {notesLocalPath} — skipping push");
        }
        else
        {
            Serilog.Log.Information("Perushim notes already on device");
        }

        // Catalog DB: bundled in Resources/Raw, the app copies it on first run.
        // No push needed — it's in the APK itself.
    }

    /// <summary>
    /// Clears stale perushim/catalog SQLite databases from the Android device/emulator.
    /// Use after re-exporting data (e.g. new perushim extraction) so the app picks up
    /// the freshly bundled databases on next launch instead of reusing a stale copy.
    /// </summary>
    void ClearAndroidAppDatabases()
    {
        var filesToDelete = new[] { NotesDbName, CatalogDbName };

        foreach (var file in filesToDelete)
        {
            var (_, _, exitCode) = RunAdb(GetAdbDeviceArgs("shell", "run-as", AppId, "rm", "-f", $"/data/data/{AppId}/files/{file}"), readStderr: true);
            Serilog.Log.Information($"Deleted {file} from device (exit={exitCode})");
        }
    }

    Target ResetAndroidData => _ => _
        .Description("Clear stale perushim databases + re-push fresh copies to device")
        .Executes(() =>
        {
            if (!IsAndroidDeviceConnected())
            {
                Serilog.Log.Warning("No Android device/emulator connected — nothing to clear");
                return;
            }

            ClearAndroidAppDatabases();
            EnsurePerushimOnDevice();
            Serilog.Log.Information("Done. Re-run the app to use fresh databases.");
        });

    Target RunIos => _ => _
        .Description("Run app on iOS simulator (starts API if needed)")
        .DependsOn(PrepareIosRecitation, Compile)
        .Executes(() =>
        {
            // iOS doesn't support dotnet run - use dotnet build -t:Run
            var startInfo = new ProcessStartInfo
            {
                FileName = "dotnet",
                Arguments = $"build \"{MainProject}\" -t:Run -f net11.0-ios -c {Configuration} --no-restore",
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
        .DependsOn(PrepareIosRecitation, Compile)
        .Executes(() =>
        {
            // Mac Catalyst doesn't support dotnet run - use dotnet build -t:Run
            var startInfo = new ProcessStartInfo
            {
                FileName = "dotnet",
                Arguments = $"build \"{MainProject}\" -t:Run -f net11.0-maccatalyst -c {Configuration} --no-restore",
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
