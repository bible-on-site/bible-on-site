namespace BibleOnSite.Tests.Support;

/// <summary>GC helpers for tests that assert released objects actually get collected.</summary>
public static class GarbageCollection
{
    /// <summary>
    /// Runs the documented collect → finalize → collect cycle so WeakReference
    /// assertions are deterministic: the second pass sweeps what the first
    /// pass's finalizers released.
    /// </summary>
    public static void CollectCycles()
    {
        //NOSONAR -- S1215 for scanners; pragma below for the Roslyn analyzer.
        // Forcing a full collection IS the assertion mechanism: these tests hold
        // a WeakReference to an object and prove nothing else roots it.
#pragma warning disable S1215
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
#pragma warning restore S1215
    }
}
