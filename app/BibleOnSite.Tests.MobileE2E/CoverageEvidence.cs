using System.Collections.Concurrent;
using System.Text.Json;
using BibleOnSite.Tests.MobileE2E.Configuration;
using OpenQA.Selenium;

namespace BibleOnSite.Tests.MobileE2E;

// Per-scenario execution evidence for deterministic E2E impact selection
// (#2085). MobileDeviceTest brackets every scenario attempt with Begin/Finish
// and the platform adapters report each automation id they translate into a
// locator. One JSON record per attempt lands in
// <artifacts>/coverage-evidence/; the e2e-impact collector maps the recorded
// ids back to the app source files declaring them.
//
// Evidence is best-effort instrumentation, not an oracle: a scenario that dies
// before Finish leaves no record for that attempt, and locators built outside
// AutomationId (raw XPath, native gestures) are unattributed. The selector
// treats missing evidence conservatively, so gaps widen selection rather than
// silently skipping affected tests.
internal static class CoverageEvidence
{
    private sealed class Scope(string test, MobilePlatform platform, string directory, string fileBase)
    {
        internal string Test { get; } = test;
        internal string Platform { get; } = platform.ToString().ToLowerInvariant();
        internal string Directory { get; } = directory;
        internal string FileBase { get; } = fileBase;
        internal ConcurrentBag<string> AutomationIds { get; } = new();
        internal ConcurrentBag<string> Sessions { get; } = new();
        internal DateTime StartedUtc { get; } = DateTime.UtcNow;
    }

    // AsyncLocal keeps evidence attributed when test collections run in
    // parallel: each async control flow observes its own scope.
    private static readonly AsyncLocal<Scope?> _current = new();

    /// <summary>Starts recording for one scenario attempt.</summary>
    /// <param name="test">Stable xUnit identity: Namespace.Class.Method.</param>
    /// <param name="fileBase">Artifact filename base (the scenario name).</param>
    internal static void Begin(string test, MobilePlatform platform, string artifactsDirectory, string fileBase)
    {
        _current.Value = new Scope(test, platform, Path.Join(artifactsDirectory, "coverage-evidence"), fileBase);
    }

    /// <summary>Attributes an automation-id lookup to the active scenario.</summary>
    internal static void RecordAutomationId(string id) => _current.Value?.AutomationIds.Add(id);

    /// <summary>Attributes an Appium session to the active scenario.</summary>
    internal static void RecordSession(SessionId? sessionId)
    {
        if (sessionId != null)
        {
            _current.Value?.Sessions.Add(sessionId.ToString());
        }
    }

    /// <summary>Persists the record for the finished attempt.</summary>
    internal static void Finish(string outcome)
    {
        var scope = _current.Value;
        _current.Value = null;
        if (scope == null)
        {
            return;
        }
        var record = new
        {
            test = scope.Test,
            platform = scope.Platform,
            outcome,
            sessions = scope.Sessions.Distinct().OrderBy(id => id, StringComparer.Ordinal).ToArray(),
            automationIds = scope.AutomationIds.Distinct().OrderBy(id => id, StringComparer.Ordinal).ToArray(),
            startedUtc = scope.StartedUtc,
            endedUtc = DateTime.UtcNow,
        };
        Directory.CreateDirectory(scope.Directory);
        // Retried attempts land on the same name+outcome file; the collector
        // reads every record, so a retry's fresh attempt overwrites the stale
        // evidence of the attempt it replaced rather than merging with it.
        File.WriteAllText(
            Path.Join(scope.Directory, $"{scope.FileBase}-{outcome}.json"),
            JsonSerializer.Serialize(record, new JsonSerializerOptions { WriteIndented = true }));
    }
}
