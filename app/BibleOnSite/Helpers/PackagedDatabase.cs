using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;

namespace BibleOnSite.Helpers;

/// <summary>Keep generated, read-only database copies aligned with the installed app.</summary>
public static class PackagedDatabase
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Locks = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Sidecar written next to a refreshed copy:
    /// "<c>{version}+{build}:{size}:{mtimeUtcTicks}</c>" — the copy's size and
    /// write time at mark time. The bundled asset is immutable per installed
    /// app version, so a matching marker proves the copy is current without
    /// reopening the packaged bytes.
    /// </summary>
    private const string MarkerSuffix = ".srcver";

    public static Task RefreshAsync(IFileSystem fileSystem, string fileName) =>
        RefreshAsync(fileSystem, fileName, null);

    /// <param name="appInfo">
    /// Source of the version+build recorded in the marker; null resolves
    /// <see cref="AppInfo.Current"/>. Tests inject a mock so the marker path is
    /// exercised without a platform app identity.
    /// </param>
    public static Task RefreshAsync(IFileSystem fileSystem, string fileName, IAppInfo? appInfo) =>
        RefreshCoreAsync(fileSystem, fileName, CurrentSourceVersion(appInfo));

    private static async Task RefreshCoreAsync(IFileSystem fileSystem, string fileName, string? sourceVersion)
    {
        var destination = Path.Join(fileSystem.AppDataDirectory, fileName);
        var marker = destination + MarkerSuffix;
        var gate = Locks.GetOrAdd(destination, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        try
        {
            // Fast path: this exact app version already produced a copy of the
            // packaged size — skip opening the asset and hashing both copies.
            if (sourceVersion != null && await CopyMatchesMarkerAsync(destination, marker, sourceVersion))
            {
                return;
            }

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
                    // Verified identical — keep the file and record that this
                    // version owns it, so later launches can skip the hash.
                    await WriteMarkerAsync(marker, sourceVersion, destination);
                    return;
                }
            }
            contents.Position = 0;
            await AtomicFile.CopyAsync(contents, destination);
            await WriteMarkerAsync(marker, sourceVersion, destination);
        }
        catch (FileNotFoundException) when (File.Exists(destination))
        {
            // Retain an offline copy if this installation has no packaged database.
        }
        finally { gate.Release(); }
    }

    /// <summary>
    /// The installed app's "version+build" identity, or null where no app
    /// identity exists — the net10.0 reference assembly used by unit tests
    /// throws its internal <c>NotImplementedInReferenceAssemblyException</c>,
    /// which can only be matched by name from outside that assembly. A null
    /// version never writes or matches a marker, keeping those hosts on the
    /// full hash-verify path exactly as before.
    /// </summary>
    private static string? CurrentSourceVersion(IAppInfo? appInfo)
    {
        try
        {
            var info = appInfo ?? AppInfo.Current;
            return $"{info.VersionString}+{info.BuildString}";
        }
        catch (Exception ex) when (ex.GetType().Name == "NotImplementedInReferenceAssemblyException")
        {
            return null;
        }
    }

    /// <summary>
    /// True when the marker names the running version and the copy still shows
    /// the size and write time it was marked with — cheap stats instead of a
    /// full re-hash. Any mismatch falls through to the hash-verify path, which
    /// also repairs a corrupted copy.
    /// </summary>
    private static async Task<bool> CopyMatchesMarkerAsync(string destination, string marker, string sourceVersion)
    {
        if (!File.Exists(destination))
        {
            return false;
        }

        var stamp = await ReadMarkerAsync(marker);
        if (stamp == null || stamp.Version != sourceVersion)
        {
            return false;
        }

        var info = new FileInfo(destination);
        return info.Length == stamp.Length && info.LastWriteTimeUtc.Ticks == stamp.WriteTimeUtcTicks;
    }

    private static async Task<SourceStamp?> ReadMarkerAsync(string marker)
    {
        try
        {
            if (!File.Exists(marker))
            {
                return null;
            }

            // "{version}+{build}:{size}:{mtimeUtcTicks}" — split from the right
            // so a separator inside the version can never corrupt the numbers.
            var text = (await File.ReadAllTextAsync(marker)).Trim();
            var ticksSeparator = text.LastIndexOf(':');
            var lengthSeparator = ticksSeparator > 0 ? text.LastIndexOf(':', ticksSeparator - 1) : -1;
            if (lengthSeparator <= 0 ||
                !long.TryParse(text.AsSpan(lengthSeparator + 1, ticksSeparator - lengthSeparator - 1),
                    NumberStyles.None, CultureInfo.InvariantCulture, out var length) ||
                !long.TryParse(text.AsSpan(ticksSeparator + 1),
                    NumberStyles.None, CultureInfo.InvariantCulture, out var writeTimeUtcTicks))
            {
                // Unknown marker shape — fall back to the hash-verify path,
                // which rewrites it on success.
                return null;
            }

            return new SourceStamp(text[..lengthSeparator], length, writeTimeUtcTicks);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // An unreadable marker is no proof of freshness — verify by hash.
            return null;
        }
    }

    private static async Task WriteMarkerAsync(string marker, string? sourceVersion, string destination)
    {
        if (sourceVersion == null)
        {
            return;
        }

        try
        {
            var info = new FileInfo(destination);
            await AtomicFile.WriteAllTextAsync(marker,
                $"{sourceVersion}:{info.Length}:{info.LastWriteTimeUtc.Ticks}");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // The marker only memoizes a verified copy — a failed write costs
            // one hash-verify on the next launch and must not fail the refresh.
            Console.Error.WriteLine($"Packaged database marker write failed for '{marker}': {ex.Message}");
        }
    }

    private sealed record SourceStamp(string Version, long Length, long WriteTimeUtcTicks);
}
