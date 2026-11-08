using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;

namespace BibleOnSite.Helpers;

internal static class DebugLog
{
    // Trace output for development builds; Release compiles the calls and their
    // interpolated arguments out of hot paths such as carousel swipes.
    [Conditional("DEBUG")]
    [ExcludeFromCodeCoverage(Justification = "Debug-only trace sink; Release unit-test builds compile every call out.")]
    internal static void Write(string message) => Console.WriteLine(message);
}
