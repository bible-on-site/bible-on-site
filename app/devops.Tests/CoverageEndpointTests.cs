using AltCover.Recorder;
using Xunit;

// The coverage/reset shared-secret lookup. The Android relaunches that drop
// intent extras authorized against a file the app persists under
// FileSystem.AppDataDirectory; the endpoint once read SpecialFolder.Personal,
// which .NET 8 moved under it (files/Documents, dotnet/runtime#102110), so
// every relaunched process found no token and reset refused with 403. These
// tests pin the per-platform directory contract the resolver now follows.
public sealed class CoverageEndpointTests
{
    private const string TokenVariable = "BIBLE_E2E_COVERAGE_TOKEN";
    private const string TokenFileName = "e2e-coverage-token";

    [Fact]
    public void EnvironmentTokenTakesPrecedenceOverAnyFile()
    {
        var previous = Environment.GetEnvironmentVariable(TokenVariable);
        try
        {
            Environment.SetEnvironmentVariable(TokenVariable, "env-token");
            Assert.Equal("env-token", CoverageEndpoint.RequiredToken());
        }
        finally
        {
            Environment.SetEnvironmentVariable(TokenVariable, previous);
        }
    }

    [Fact]
    public void MissingEnvironmentAndFileReturnsNull()
    {
        var previous = Environment.GetEnvironmentVariable(TokenVariable);
        try
        {
            Environment.SetEnvironmentVariable(TokenVariable, null);
            var directory = CoverageEndpoint.PersistedTokenDirectory();
            // A host that already persists a token legitimately resolves
            // it; the null contract only holds where nothing is configured.
            if (directory != null && File.Exists(Path.Join(directory, TokenFileName)))
            {
                return;
            }
            Assert.Null(CoverageEndpoint.RequiredToken());
        }
        finally
        {
            Environment.SetEnvironmentVariable(TokenVariable, previous);
        }
    }

    [Fact]
    public void DesktopHostResolvesThroughTheDesktopBranch()
    {
        // The RuntimeInformation.IsOSPlatform probes can only report
        // desktop on the test host; pin the glue that does hold — the
        // resolved directory is the desktop branch of the same mapping.
        Assert.Equal(
            CoverageEndpoint.AppDataDirectoryEquivalent("DESKTOP", "ignored-home"),
            CoverageEndpoint.PersistedTokenDirectory());
    }

    [Fact]
    public void AndroidResolvesTheAppFilesDirectory()
    {
        // FileSystem.AppDataDirectory on Android is the app files dir, which
        // the .NET runtime exports as HOME — not its Documents subdirectory.
        var filesDir = "/data/user/0/com.tanah.daily929/files";
        Assert.Equal(filesDir, CoverageEndpoint.AppDataDirectoryEquivalent("ANDROID", filesDir));
        Assert.Null(CoverageEndpoint.AppDataDirectoryEquivalent("ANDROID", null));
    }

    [Fact]
    public void ApplePlatformsResolveTheContainerLibrary()
    {
        var container = "/private/var/mobile/Containers/Data/Application/AAAA-BBBB";
        var expected = Path.Join(container, "Library");
        Assert.Equal(expected, CoverageEndpoint.AppDataDirectoryEquivalent("IOS", container));
        Assert.Equal(expected, CoverageEndpoint.AppDataDirectoryEquivalent("MACCATALYST", container));
        Assert.Equal(expected, CoverageEndpoint.AppDataDirectoryEquivalent("TVOS", container));
        Assert.Equal(expected, CoverageEndpoint.AppDataDirectoryEquivalent("WATCHOS", container));
        Assert.Null(CoverageEndpoint.AppDataDirectoryEquivalent("IOS", null));
    }

    [Fact]
    public void DesktopFallsBackToThePersonalFolder()
    {
        // Suite launches on Windows/desktop always carry the token in the
        // process environment; the file fallback only needs a per-user dir.
        var personal = Environment.GetFolderPath(Environment.SpecialFolder.Personal);
        var expected = string.IsNullOrEmpty(personal) ? null : personal;
        Assert.Equal(expected, CoverageEndpoint.AppDataDirectoryEquivalent("DESKTOP", "/home/x"));
        Assert.Equal(expected, CoverageEndpoint.AppDataDirectoryEquivalent("something-else", null));
    }

    [Fact]
    public void TokenFileLookupReadsTrimsAndRejectsEmpty()
    {
        var directory = Directory.CreateDirectory(
            Path.Join(Path.GetTempPath(), "coverage-endpoint-" + Guid.NewGuid().ToString("N")));
        var path = Path.Join(directory.FullName, TokenFileName);
        try
        {
            Assert.Null(CoverageEndpoint.RequiredTokenFromDirectory(null));
            Assert.Null(CoverageEndpoint.RequiredTokenFromDirectory(directory.FullName));

            File.WriteAllText(path, "   \r\n");
            Assert.Null(CoverageEndpoint.RequiredTokenFromDirectory(directory.FullName));

            File.WriteAllText(path, "  file-token\r\n");
            Assert.Equal("file-token", CoverageEndpoint.RequiredTokenFromDirectory(directory.FullName));
        }
        finally
        {
            directory.Delete(recursive: true);
        }
    }
}
