using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace BibleOnSite.Helpers;

/// <summary>Keep generated, read-only database copies aligned with the installed app.</summary>
public static class PackagedDatabase
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Locks = new(StringComparer.OrdinalIgnoreCase);

    public static async Task RefreshAsync(IFileSystem fileSystem, string fileName)
    {
        var destination = Path.Combine(fileSystem.AppDataDirectory, fileName);
        var gate = Locks.GetOrAdd(destination, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        try
        {
            await using var source = await fileSystem.OpenAppPackageFileAsync(fileName);
            // Package streams need not support seeking. These bundled databases are small.
            using var contents = new MemoryStream();
            await source.CopyToAsync(contents);
            contents.Position = 0;
            if (File.Exists(destination))
            {
                await using var existing = new FileStream(destination, FileMode.Open, FileAccess.Read,
                    FileShare.ReadWrite | FileShare.Delete);
                var existingHash = await SHA256.HashDataAsync(existing);
                var packagedHash = await SHA256.HashDataAsync(contents);
                if (existingHash.AsSpan().SequenceEqual(packagedHash))
                {
                    return;
                }
            }
            contents.Position = 0;
            await AtomicFile.CopyAsync(contents, destination);
        }
        catch (FileNotFoundException) when (File.Exists(destination))
        {
            // Retain an offline copy if this installation has no packaged database.
        }
        finally { gate.Release(); }
    }
}
