using System.Diagnostics;

namespace BibleOnSite.Helpers;

internal static class NativeReaderTrace
{
    // Explicit long-note debug diagnostics contain operation names and sizes,
    // never commentary content. Release builds omit these calls.
    [Conditional("DEBUG")]
    internal static void Write(string operation)
    {
        if (Environment.GetEnvironmentVariable("BIBLE_E2E_LONG_PERUSHIM") == "1")
        {
            Console.WriteLine($"NATIVE_READER {Stopwatch.GetTimestamp()} thread={Environment.CurrentManagedThreadId} {operation}");
        }
    }
}
