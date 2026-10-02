namespace BibleOnSite.Helpers;

/// <summary>Publish a completed file without exposing partially copied assets or cache data.</summary>
public static class AtomicFile
{
    public static Task CopyAsync(Stream source, string destination) => ReplaceAsync(destination, async temporary =>
    {
        await using var target = File.Create(temporary);
        await source.CopyToAsync(target);
    });

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
