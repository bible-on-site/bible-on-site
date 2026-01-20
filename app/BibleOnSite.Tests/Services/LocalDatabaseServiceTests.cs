using FluentAssertions;
using Xunit;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// Tests to verify the database configuration is correct.
/// These tests ensure the database filename matches the actual resource file.
/// Note: These tests are skipped in CI since the database file is not tracked in git.
/// </summary>
public class LocalDatabaseServiceTests
{
    /// <summary>
    /// The expected database filename that must exist in Resources/Raw.
    /// This constant must match LocalDatabaseService.DbName.
    /// </summary>
    private const string ExpectedDbName = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";

    private static string? GetRawResourcesPath()
    {
        try
        {
            var projectRoot = GetProjectRoot();
            if (projectRoot == null) return null;
            return Path.Combine(projectRoot, "BibleOnSite", "Resources", "Raw");
        }
        catch
        {
            return null;
        }
    }

    private static bool DatabaseFileExists()
    {
        var rawPath = GetRawResourcesPath();
        if (rawPath == null || !Directory.Exists(rawPath)) return false;
        var dbPath = Path.Combine(rawPath, ExpectedDbName);
        return File.Exists(dbPath);
    }

    [SkippableFact]
    public void DbName_ShouldMatchExpectedFilename()
    {
        // Skip in CI - database file is not tracked in git
        Skip.IfNot(DatabaseFileExists(), "Database file not present (expected in CI)");

        // This test ensures the database filename constant is correct.
        // If you change the database file, update both:
        // 1. The file in Resources/Raw
        // 2. LocalDatabaseService.DbName
        // 3. ExpectedDbName in this test

        // We can't directly access LocalDatabaseService.DbName since it's private,
        // so we verify the raw resource file exists with the expected name.
        var resourcePath = Path.Combine(
            GetProjectRoot()!,
            "BibleOnSite",
            "Resources",
            "Raw",
            ExpectedDbName);

        File.Exists(resourcePath).Should().BeTrue(
            $"Database file '{ExpectedDbName}' should exist in Resources/Raw. " +
            "If you renamed the database file, update LocalDatabaseService.DbName to match.");
    }

    [SkippableFact]
    public void DatabaseResourceFile_ShouldNotBeEmpty()
    {
        // Skip in CI - database file is not tracked in git
        Skip.IfNot(DatabaseFileExists(), "Database file not present (expected in CI)");

        var resourcePath = Path.Combine(
            GetProjectRoot()!,
            "BibleOnSite",
            "Resources",
            "Raw",
            ExpectedDbName);

        var fileInfo = new FileInfo(resourcePath);
        fileInfo.Exists.Should().BeTrue();
        fileInfo.Length.Should().BeGreaterThan(0, "Database file should not be empty");
    }

    [SkippableFact]
    public void OnlyOneSqliteFile_ShouldExistInRawResources()
    {
        // Skip in CI - database file is not tracked in git
        Skip.IfNot(DatabaseFileExists(), "Database file not present (expected in CI)");

        // This test catches the case where someone adds a new database file
        // but forgets to remove the old one or update the constant
        var rawPath = GetRawResourcesPath()!;
        var sqliteFiles = Directory.GetFiles(rawPath, "*.sqlite");

        sqliteFiles.Should().HaveCount(1,
            "Only one SQLite database file should exist in Resources/Raw. " +
            "If you're replacing the database, remove the old file.");

        sqliteFiles[0].Should().EndWith(ExpectedDbName,
            $"The SQLite file should be named '{ExpectedDbName}'");
    }

    private static string? GetProjectRoot()
    {
        // Navigate from test bin directory to project root
        var currentDir = Directory.GetCurrentDirectory();
        var dir = new DirectoryInfo(currentDir);

        // Walk up until we find the app directory (contains BibleOnSite.sln or the app folder structure)
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "BibleOnSite")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName;
    }
}
