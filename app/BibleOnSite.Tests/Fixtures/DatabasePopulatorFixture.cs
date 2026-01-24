using System.Diagnostics;

namespace BibleOnSite.Tests.Fixtures;

/// <summary>
/// xUnit fixture that ensures the test database is populated before tests run.
/// This fixture runs ONCE per test collection and populates the database if needed.
///
/// Runs `cargo make mysql-populate` to populate the test database (idempotent operation).
/// The fixture reuses the same db-populator logic used by CI (data/Makefile.toml).
/// </summary>
public class DatabasePopulatorFixture : IAsyncLifetime
{
    private const string TestDbUrl = "mysql://root:test_123@localhost:3306/tanah_test?ssl-mode=DISABLED";

    public async Task InitializeAsync()
    {
        // Populate the test database (idempotent - safe to run multiple times)
        Console.WriteLine("[DatabasePopulatorFixture] Ensuring test database is populated...");

        var dataDir = FindDataDirectory();
        if (dataDir == null)
        {
            throw new InvalidOperationException(
                "Could not find the data directory. Ensure you're running from within the repository.");
        }

        // Check if cargo and cargo-make are available
        if (!await IsCargoMakeAvailable())
        {
            Console.WriteLine("[DatabasePopulatorFixture] WARNING: cargo-make not available. Cannot auto-populate database.");
            Console.WriteLine("[DatabasePopulatorFixture] Please manually run: cd data && cargo make mysql-populate");
            Console.WriteLine("[DatabasePopulatorFixture] Or install cargo-make: cargo install cargo-make");
            return;
        }

        // Run cargo make mysql-populate
        await PopulateDatabase(dataDir);
    }

    public Task DisposeAsync()
    {
        // Nothing to clean up - we leave the test data for inspection if needed
        return Task.CompletedTask;
    }

    private static async Task<bool> IsCargoMakeAvailable()
    {
        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = "cargo",
                Arguments = "make --version",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using var process = Process.Start(startInfo);
            if (process == null) return false;

            await process.WaitForExitAsync();
            return process.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    private static async Task PopulateDatabase(string dataDir)
    {
        Console.WriteLine($"[DatabasePopulatorFixture] Populating test database from {dataDir}...");

        var startInfo = new ProcessStartInfo
        {
            FileName = "cargo",
            Arguments = "make mysql-populate",
            WorkingDirectory = dataDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        // Set DB_URL for the populator
        startInfo.Environment["DB_URL"] = TestDbUrl;

        using var process = new Process { StartInfo = startInfo };

        var outputBuilder = new System.Text.StringBuilder();
        var errorBuilder = new System.Text.StringBuilder();

        process.OutputDataReceived += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                outputBuilder.AppendLine(e.Data);
                Console.WriteLine($"[db-populator] {e.Data}");
            }
        };

        process.ErrorDataReceived += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                errorBuilder.AppendLine(e.Data);
                Console.Error.WriteLine($"[db-populator ERROR] {e.Data}");
            }
        };

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        // Wait up to 2 minutes for database population
        var completed = await Task.Run(() => process.WaitForExit(120_000));

        if (!completed)
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            throw new TimeoutException("Database population timed out after 2 minutes");
        }

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"Database population failed with exit code {process.ExitCode}.\n" +
                $"Error output:\n{errorBuilder}");
        }

        Console.WriteLine("[DatabasePopulatorFixture] Test database populated successfully");
    }

    private static string? FindDataDirectory()
    {
        // Try to find the data directory relative to the test project
        var currentDir = Directory.GetCurrentDirectory();

        // Walk up the directory tree to find the repository root
        var dir = new DirectoryInfo(currentDir);
        while (dir != null)
        {
            var dataPath = Path.Combine(dir.FullName, "data");
            if (Directory.Exists(dataPath))
            {
                // Verify it's the right data directory by checking for Makefile.toml
                var makefileToml = Path.Combine(dataPath, "Makefile.toml");
                if (File.Exists(makefileToml))
                {
                    return dataPath;
                }
            }

            // Also check if we're in the repo root (has bible-on-site.sln)
            var slnPath = Path.Combine(dir.FullName, "bible-on-site.sln");
            if (File.Exists(slnPath))
            {
                var dataPath2 = Path.Combine(dir.FullName, "data");
                if (Directory.Exists(dataPath2))
                {
                    return dataPath2;
                }
            }

            dir = dir.Parent;
        }

        return null;
    }
}
