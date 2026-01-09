using System;
using System.Diagnostics;
using System.Net.Http;
using Nuke.Common;
using Nuke.Common.IO;
using Nuke.Common.Tools.DotNet;
using static Nuke.Common.Tools.DotNet.DotNetTasks;

partial class Build
{
    /// <summary>
    /// Checks if API server is running on port 3003.
    /// </summary>
    bool IsApiRunning()
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            var response = client.GetAsync("http://localhost:3003/api/graphql").Result;
            return response.IsSuccessStatusCode || response.StatusCode == System.Net.HttpStatusCode.BadRequest;
        }
        catch
        {
            return false;
        }
    }

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
            Arguments = "make run-api",
            WorkingDirectory = apiPath,
            UseShellExecute = true,
            CreateNoWindow = false,
        };

        var process = Process.Start(startInfo);
        if (process == null)
        {
            Serilog.Log.Warning("Failed to start API server process");
            return;
        }

        // Wait for API to be ready (max 120 seconds - Rust compilation can take a while)
        var timeout = DateTime.Now.AddSeconds(120);
        var attempts = 0;
        while (DateTime.Now < timeout)
        {
            attempts++;
            System.Threading.Thread.Sleep(2000);
            if (IsApiRunning())
            {
                Serilog.Log.Information($"API server started successfully (after ~{attempts * 2} seconds)");
                return;
            }
            if (attempts % 10 == 0)
            {
                Serilog.Log.Information($"Still waiting for API... ({attempts * 2}s elapsed)");
            }
        }

        Serilog.Log.Warning("API server did not respond within 120 seconds - check the API terminal");
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
            DotNetRun(s => s
                .SetProjectFile(MainProject)
                .SetFramework("net9.0-windows10.0.19041.0")
                .SetConfiguration(Configuration)
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target RunAndroid => _ => _
        .Description("Run app on Android emulator (starts API if needed)")
        .DependsOn(Compile)
        .Executes(() =>
        {
            DotNetRun(s => s
                .SetProjectFile(MainProject)
                .SetFramework("net9.0-android")
                .SetConfiguration(Configuration)
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target RunIos => _ => _
        .Description("Run app on iOS simulator (starts API if needed)")
        .DependsOn(Compile)
        .Executes(() =>
        {
            DotNetRun(s => s
                .SetProjectFile(MainProject)
                .SetFramework("net9.0-ios")
                .SetConfiguration(Configuration)
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target RunMac => _ => _
        .Description("Run app on Mac Catalyst (starts API if needed)")
        .DependsOn(Compile)
        .Executes(() =>
        {
            DotNetRun(s => s
                .SetProjectFile(MainProject)
                .SetFramework("net9.0-maccatalyst")
                .SetConfiguration(Configuration)
                .EnableNoRestore()
                .EnableNoBuild());
        });
}
