using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Xml.Linq;

/// <summary>
/// Pure dump→OpenCover application for real app-process coverage (#1232),
/// split from the NUKE target so the semantics are unit-testable without
/// instantiating the build class.
/// </summary>
internal static class E2ECoverageApply
{
    internal sealed record Stats(int IncompatibleDumps, int UnknownPointIds,
        int SequencePointsVisited, int BranchPointsVisited);

    /// <summary>
    /// Sums dump hit counts into the template's vc attributes. Sequence points
    /// are visited by their uspid; branch points encode uspid | int.MinValue
    /// in the Visit call; method-entry visits arrive keyed by the method's
    /// metadata token (0x06xxxxxx) and mark the Method element visited.
    /// Dumps keyed to a different module hash (a stale build's dump) are
    /// counted incompatible rather than misapplied.
    /// </summary>
    /// <param name="modules">Module elements of the OpenCover template.</param>
    /// <param name="dumps">(name, raw json) pairs of app-e2e-coverage-dump/1 records.</param>
    /// <param name="warn">Optional warning sink; defaults to a no-op.</param>
    internal static long ApplyDumps(List<XElement> modules,
        IReadOnlyList<(string Name, string Json)> dumps, out Stats stats,
        Action<string>? warn = null)
    {
        warn ??= _ => { };
        var modulesByHash = modules
            .Select(m => (Hash: m.Attribute("hash")?.Value, Element: m))
            .Where(m => m.Hash != null)
            .ToDictionary(m => m.Hash!, m => m.Element, StringComparer.OrdinalIgnoreCase);
        var sequencePoints = new Dictionary<(XElement, int), XElement>();
        var branchPoints = new Dictionary<(XElement, int), XElement>();
        // Method-entry visits arrive keyed by the method's metadata token
        // (0x06xxxxxx); they carry no line info but mark the method visited.
        var methodTokens = new Dictionary<(XElement, int), XElement>();
        foreach (var module in modules)
        {
            foreach (var point in module.Descendants("SequencePoint"))
            {
                if (int.TryParse(point.Attribute("uspid")?.Value, out var id))
                {
                    sequencePoints[(module, id)] = point;
                }
            }
            foreach (var point in module.Descendants("BranchPoint"))
            {
                if (int.TryParse(point.Attribute("uspid")?.Value, out var id))
                {
                    branchPoints[(module, id)] = point;
                }
            }
            foreach (var method in module.Descendants("Method"))
            {
                var token = method.Element("MetadataToken")?.Value;
                if (int.TryParse(token, out var id))
                {
                    methodTokens[(module, id)] = method;
                }
            }
        }

        long applied = 0;
        var incompatible = 0;
        var unknown = 0;
        foreach (var (name, json) in dumps)
        {
            using var dump = JsonDocument.Parse(json);
            if (!dump.RootElement.TryGetProperty("snapshot", out var snapshot) ||
                !snapshot.TryGetProperty("modules", out var dumpModules))
            {
                incompatible++;
                warn($"Coverage dump {name} has no snapshot.modules; skipped.");
                continue;
            }
            var matchedAnyModule = false;
            foreach (var moduleProperty in dumpModules.EnumerateObject())
            {
                if (!modulesByHash.TryGetValue(moduleProperty.Name, out var module))
                {
                    continue;
                }
                matchedAnyModule = true;
                foreach (var point in moduleProperty.Value.EnumerateObject())
                {
                    if (!int.TryParse(point.Name, out var key))
                    {
                        continue;
                    }
                    var count = point.Value.GetInt64();
                    if (key < 0)
                    {
                        if (branchPoints.TryGetValue((module, key & 0x7FFFFFFF), out var branch))
                        {
                            var current = long.TryParse(branch.Attribute("vc")?.Value, out var vc) ? vc : 0;
                            branch.SetAttributeValue("vc", current + count);
                            applied += count;
                        }
                        else
                        {
                            unknown++;
                        }
                    }
                    else if (sequencePoints.TryGetValue((module, key), out var sequence))
                    {
                        var current = long.TryParse(sequence.Attribute("vc")?.Value, out var vc) ? vc : 0;
                        sequence.SetAttributeValue("vc", current + count);
                        applied += count;
                    }
                    else if (methodTokens.TryGetValue((module, key), out var method))
                    {
                        method.SetAttributeValue("visited", "true");
                        applied += count;
                    }
                    else
                    {
                        unknown++;
                    }
                }
            }
            if (!matchedAnyModule)
            {
                incompatible++;
                warn(
                    $"Coverage dump {name} matches no instrumented module hash; " +
                    "it was produced by a different build and was skipped.");
            }
        }
        var seqVisited = sequencePoints.Values.Count(p => (long.TryParse(p.Attribute("vc")?.Value, out var v) ? v : 0) > 0);
        var brVisited = branchPoints.Values.Count(p => (long.TryParse(p.Attribute("vc")?.Value, out var v) ? v : 0) > 0);
        stats = new Stats(incompatible, unknown, seqVisited, brVisited);
        return applied;
    }

    /// <summary>Recomputes visited counters in the module summaries after applying dumps.</summary>
    internal static void UpdateModuleSummaries(List<XElement> modules)
    {
        foreach (var module in modules)
        {
            foreach (var summary in module.Descendants("Summary"))
            {
                var scope = summary.Parent;
                if (scope == null)
                {
                    continue;
                }
                var seq = scope.Descendants("SequencePoint").ToList();
                var br = scope.Descendants("BranchPoint").ToList();
                var visitedSeq = seq.Count(p => (long.TryParse(p.Attribute("vc")?.Value, out var v) ? v : 0) > 0);
                var visitedBr = br.Count(p => (long.TryParse(p.Attribute("vc")?.Value, out var v) ? v : 0) > 0);
                summary.SetAttributeValue("visitedSequencePoints", visitedSeq);
                summary.SetAttributeValue("visitedBranchPoints", visitedBr);
                if (seq.Count > 0)
                {
                    summary.SetAttributeValue("sequenceCoverage",
                        Math.Round(visitedSeq * 100.0 / seq.Count, 2).ToString(System.Globalization.CultureInfo.InvariantCulture));
                }
                if (br.Count > 0)
                {
                    summary.SetAttributeValue("branchCoverage",
                        Math.Round(visitedBr * 100.0 / br.Count, 2).ToString(System.Globalization.CultureInfo.InvariantCulture));
                }
            }
        }
    }
}
