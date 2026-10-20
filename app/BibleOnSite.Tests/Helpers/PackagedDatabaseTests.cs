using System.Text;
using BibleOnSite.Helpers;
using BibleOnSite.Tests.Support;

namespace BibleOnSite.Tests.Helpers;

public class PackagedDatabaseTests
{
    private const string DbName = "packaged.sqlite";
    private const string Version = "5.0.172+172";
    private const string OlderVersion = "5.0.171+171";

    private static string Destination(TestStorage storage) => Path.Join(storage.Root, DbName);
    private static string Marker(TestStorage storage) => Destination(storage) + ".srcver";

    private static IAppInfo AppMock(string version = "5.0.172", string build = "172")
    {
        var app = new Mock<IAppInfo>();
        app.SetupGet(a => a.VersionString).Returns(version);
        app.SetupGet(a => a.BuildString).Returns(build);
        return app.Object;
    }

    private static byte[] Payload(string text) => Encoding.UTF8.GetBytes(text);

    /// <summary>Stamps the destination with a well-formed marker for <paramref name="version"/>.</summary>
    private static Task WriteMarkerAsync(TestStorage storage, string version)
    {
        var info = new FileInfo(Destination(storage));
        return File.WriteAllTextAsync(Marker(storage),
            $"{version}:{info.Length}:{info.LastWriteTimeUtc.Ticks}", TestContext.Current.CancellationToken);
    }

    /// <summary>The marker text that describes the destination as it is right now.</summary>
    private static string ExpectedMarker(TestStorage storage)
    {
        var info = new FileInfo(Destination(storage));
        return $"{Version}:{info.Length}:{info.LastWriteTimeUtc.Ticks}";
    }

    [Fact]
    public async Task FreshCopy_CopiesPackage_AndWritesVersionMarker()
    {
        await using var storage = new TestStorage();
        var payload = Payload("bundled");
        storage.PackageFiles[DbName] = payload;

        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, AppMock());

        (await File.ReadAllBytesAsync(Destination(storage), TestContext.Current.CancellationToken))
            .Should().Equal(payload);
        (await File.ReadAllTextAsync(Marker(storage), TestContext.Current.CancellationToken))
            .Should().Be(ExpectedMarker(storage));
    }

    [Fact]
    public async Task MarkerMatch_SkipsPackageOpenEntirely()
    {
        await using var storage = new TestStorage();
        storage.PackageFiles[DbName] = Payload("bundled");
        var app = AppMock();

        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, app);
        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, app);

        storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync(It.IsAny<string>()), Times.Once);
    }

    [Fact]
    public async Task ConcurrentRefreshes_ShareOnePackageRead()
    {
        await using var storage = new TestStorage();
        storage.PackageFiles[DbName] = Payload("bundled");
        var app = AppMock();

        await Task.WhenAll(
            PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, app),
            PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, app));

        storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync(It.IsAny<string>()), Times.Once);
        File.Exists(Marker(storage)).Should().BeTrue();
    }

    [Fact]
    public async Task OlderVersionMarker_ReverifiesHash_AndRestamps()
    {
        await using var storage = new TestStorage();
        var payload = Payload("bundled");
        storage.PackageFiles[DbName] = payload;
        await File.WriteAllBytesAsync(Destination(storage), payload, TestContext.Current.CancellationToken);
        await WriteMarkerAsync(storage, OlderVersion);

        // Same content, new version: hash-verify proves it current, then restamps.
        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, AppMock());
        (await File.ReadAllTextAsync(Marker(storage), TestContext.Current.CancellationToken))
            .Should().Be(ExpectedMarker(storage));

        // The restamped marker now serves the fast path.
        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, AppMock());
        storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync(It.IsAny<string>()), Times.Once);
    }

    [Fact]
    public async Task OlderVersionMarker_WithChangedPackage_Recopies()
    {
        await using var storage = new TestStorage();
        storage.PackageFiles[DbName] = Payload("updated");
        await File.WriteAllBytesAsync(Destination(storage), Payload("outdated"),
            TestContext.Current.CancellationToken);
        await WriteMarkerAsync(storage, OlderVersion);

        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, AppMock());

        (await File.ReadAllBytesAsync(Destination(storage), TestContext.Current.CancellationToken))
            .Should().Equal(Payload("updated"));
    }

    [Fact]
    public async Task CurrentMarker_ButTruncatedCopy_RepairsFromPackage()
    {
        await using var storage = new TestStorage();
        var payload = Payload("bundled");
        storage.PackageFiles[DbName] = payload;
        // The marker still claims the packaged size — the short copy rejects it.
        var truncated = Payload("bundled")[..3];
        await File.WriteAllBytesAsync(Destination(storage), truncated, TestContext.Current.CancellationToken);
        await File.WriteAllTextAsync(Marker(storage),
            $"{Version}:{payload.Length}:{new FileInfo(Destination(storage)).LastWriteTimeUtc.Ticks}",
            TestContext.Current.CancellationToken);

        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, AppMock());

        (await File.ReadAllBytesAsync(Destination(storage), TestContext.Current.CancellationToken))
            .Should().Equal(payload);
        storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync(It.IsAny<string>()), Times.Once);
    }

    [Fact]
    public async Task CurrentMarker_ButCorruptedCopy_RepairsFromPackage()
    {
        await using var storage = new TestStorage();
        var payload = Payload("bundled");
        storage.PackageFiles[DbName] = payload;
        // A healthy copy was marked, then the file was rewritten (same length —
        // only the recorded write-time betrays the swap before the hash runs).
        await File.WriteAllBytesAsync(Destination(storage), payload, TestContext.Current.CancellationToken);
        await WriteMarkerAsync(storage, Version);
        await File.WriteAllBytesAsync(Destination(storage), Payload("BUNDLED"),
            TestContext.Current.CancellationToken);
        // Linux stamps mtime from a coarse clock; back-to-back writes can share it.
        File.SetLastWriteTimeUtc(Destination(storage), File.GetLastWriteTimeUtc(Destination(storage)).AddSeconds(1));

        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, AppMock());

        (await File.ReadAllBytesAsync(Destination(storage), TestContext.Current.CancellationToken))
            .Should().Equal(payload);
    }

    [Fact]
    public async Task UnreadableMarker_FallsBackToHashVerify()
    {
        await using var storage = new TestStorage();
        var payload = Payload("bundled");
        storage.PackageFiles[DbName] = payload;
        await File.WriteAllBytesAsync(Destination(storage), payload, TestContext.Current.CancellationToken);
        await File.WriteAllTextAsync(Marker(storage), "unreadable",
            TestContext.Current.CancellationToken);
        // Mode 000 makes the read throw on non-root runners; as root the file
        // still reads and merely fails parsing — the outcome is identical.
        File.SetUnixFileMode(Marker(storage), UnixFileMode.None);

        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, AppMock());

        (await File.ReadAllBytesAsync(Destination(storage), TestContext.Current.CancellationToken))
            .Should().Equal(payload);
    }

    [Fact]
    public async Task MalformedMarker_FallsBackToHashVerify_AndRewrites()
    {
        await using var storage = new TestStorage();
        var payload = Payload("bundled");
        storage.PackageFiles[DbName] = payload;
        await File.WriteAllBytesAsync(Destination(storage), payload, TestContext.Current.CancellationToken);
        await File.WriteAllTextAsync(Marker(storage), "not-a-version-marker",
            TestContext.Current.CancellationToken);

        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, AppMock());

        (await File.ReadAllTextAsync(Marker(storage), TestContext.Current.CancellationToken))
            .Should().Be(ExpectedMarker(storage));
        storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync(It.IsAny<string>()), Times.Once);
    }

    [Fact]
    public async Task UnmarkedIdenticalCopy_VerifiesHash_ThenSkipsNextTime()
    {
        await using var storage = new TestStorage();
        var payload = Payload("bundled");
        storage.PackageFiles[DbName] = payload;
        // A copy from an older app build predating markers.
        await File.WriteAllBytesAsync(Destination(storage), payload, TestContext.Current.CancellationToken);

        var app = AppMock();
        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, app);
        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, app);

        File.Exists(Marker(storage)).Should().BeTrue();
        storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync(It.IsAny<string>()), Times.Once);
    }

    [Fact]
    public async Task MarkerWriteFailure_StillCompletesRefresh()
    {
        await using var storage = new TestStorage();
        var payload = Payload("bundled");
        storage.PackageFiles[DbName] = payload;
        // The .srcver path is occupied by a directory, so publishing the marker
        // fails — the copy itself must still land; the next launch just verifies
        // by hash again.
        Directory.CreateDirectory(Marker(storage));

        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, AppMock());

        (await File.ReadAllBytesAsync(Destination(storage), TestContext.Current.CancellationToken))
            .Should().Equal(payload);
    }

    [Fact]
    public async Task MissingPackage_WithExistingCopy_RetainsCopy_WithoutMarking()
    {
        await using var storage = new TestStorage();
        await File.WriteAllBytesAsync(Destination(storage), Payload("offline"),
            TestContext.Current.CancellationToken);

        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, AppMock());

        (await File.ReadAllBytesAsync(Destination(storage), TestContext.Current.CancellationToken))
            .Should().Equal(Payload("offline"));
        File.Exists(Marker(storage)).Should().BeFalse();
    }

    [Fact]
    public async Task MissingPackage_WithoutCopy_Throws()
    {
        await using var storage = new TestStorage();

        await FluentActions.Awaiting(
                () => PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName, AppMock()))
            .Should().ThrowAsync<FileNotFoundException>();
    }

    [Fact]
    public async Task WithoutAppIdentity_KeepsHashVerify_AndWritesNoMarker()
    {
        // The net10.0 reference assembly has no AppInfo: every launch must fall
        // back to hashing — exactly the pre-marker behavior.
        await using var storage = new TestStorage();
        storage.PackageFiles[DbName] = Payload("bundled");

        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName);
        await PackagedDatabase.RefreshAsync(storage.FileSystem.Object, DbName);

        File.Exists(Marker(storage)).Should().BeFalse();
        storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync(It.IsAny<string>()), Times.Exactly(2));
    }
}
