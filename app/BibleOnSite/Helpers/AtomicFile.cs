namespace BibleOnSite.Helpers;

/// <summary>Publish a completed file without exposing partially copied assets or cache data.</summary>
public static class AtomicFile
{
    public static Task CopyAsync(Stream source, string destination) => ReplaceAsync(destination, async temporary =>
    {
        await using var target = File.Create(temporary);
        await source.CopyToAsync(target);
    });

    /// <summary>Adopt an existing payload without copying on the same filesystem.
    /// Cross-volume moves complete at a temporary destination before publication.</summary>
    public static void Move(string source, string destination)
    {
        var temporary = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.Move(source, temporary);
            File.Move(temporary, destination, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary))
            {
                // Publication failed: retain the complete delivered payload for recovery.
                File.Move(temporary, source);
            }
        }
    }

    public static Task WriteAllTextAsync(string destination, string text) =>
        ReplaceAsync(destination, temporary => File.WriteAllTextAsync(temporary, text));

    private static async Task ReplaceAsync(string destination, Func<string, Task> write)
    {
        var temporary = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await write(temporary);
            File.Move(temporary, destination, overwrite: true);
        }
        finally
        {
            File.Delete(temporary);
        }
    }
}
