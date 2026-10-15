using System.Runtime.CompilerServices;
using System.Text.Json;

namespace BibleOnSite.Tests.MobileE2E;

internal static class HostDiagnostics
{
    // Register only this harness's own processes. The outer runner removes the
    // directory before launching; no process-name scan can attach to another run.
    [ModuleInitializer]
    internal static void Register()
    {
        var directory = Environment.GetEnvironmentVariable("MOBILE_E2E_HOST_DIAGNOSTICS");
        if (string.IsNullOrEmpty(directory))
        {
            return;
        }
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Join(directory, $"host-{Environment.ProcessId}.json"),
            JsonSerializer.Serialize(new { pid = Environment.ProcessId }));
    }
}
