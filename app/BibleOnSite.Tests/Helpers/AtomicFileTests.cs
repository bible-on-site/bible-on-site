using System.Text;
using BibleOnSite.Helpers;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;

namespace BibleOnSite.Tests.Helpers;

public class AtomicFileTests
{
    private sealed class BrokenReadStream : MemoryStream
    {
        public override async Task CopyToAsync(Stream destination, int bufferSize, CancellationToken cancellationToken)
        {
            ArgumentOutOfRangeException.ThrowIfNegativeOrZero(bufferSize);
            await destination.WriteAsync(Encoding.UTF8.GetBytes("partial"), cancellationToken);
            throw new IOException("interrupted transfer");
        }
    }

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public async Task Copy_WhenInterrupted_PreservesExistingFile_AndRemovesTemporaryFile(bool exists)
    {
        await using var storage = new TestStorage();
        var destination = Path.Combine(storage.Root, "data.sqlite");
        if (exists)
        {
            await File.WriteAllTextAsync(destination, "original", TestContext.Current.CancellationToken);
        }
        await using var stream = new BrokenReadStream();
        await FluentActions.Awaiting(() => AtomicFile.CopyAsync(stream, destination))
            .Should().ThrowAsync<IOException>().WithMessage("interrupted transfer");
        if (exists)
        {
            (await File.ReadAllTextAsync(destination, TestContext.Current.CancellationToken)).Should().Be("original");
        }
        else
        {
            File.Exists(destination).Should().BeFalse();
        }
        Directory.GetFiles(storage.Root, "*.tmp").Should().BeEmpty();
    }

    [Fact]
    public async Task Database_WhenCopyIsInterrupted_RetriesPackageWithoutUsingPartialDatabase()
    {
        await using var storage = new TestStorage();
        const string name = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";
        await storage.BundleDatabaseAsync(name, "CREATE TABLE sample (value TEXT)", "INSERT INTO sample VALUES ('complete')");
        storage.FileSystem.SetupSequence(f => f.OpenAppPackageFileAsync(name))
            .ReturnsAsync(new BrokenReadStream())
            .ReturnsAsync(new MemoryStream(storage.PackageFiles[name]));
        var service = new LocalDatabaseService(storage.FileSystem.Object);
        await FluentActions.Awaiting(() => service.InitializeAsync()).Should().ThrowAsync<IOException>();
        File.Exists(Path.Combine(storage.Root, name)).Should().BeFalse();
        await service.InitializeAsync();
        (await (await service.GetDatabaseAsync()).ExecuteScalarAsync<string>("SELECT value FROM sample")).Should().Be("complete");
        storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync(name), Times.Exactly(2));
    }
}
