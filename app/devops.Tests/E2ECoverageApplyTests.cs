using System.Text.Json;
using System.Xml.Linq;
using Xunit;

// Fixture tests for the app-process coverage apply path (#1232): the same
// logic the CoverageMobileE2E / CoverageE2EWindows NUKE targets run against
// per-test dumps pulled from the instrumented app's endpoint.
public class E2ECoverageApplyTests
{
    private const string Hash = "AA-BB-CC";

    private static List<XElement> Modules()
    {
        var document = XDocument.Parse("""
            <CoverageSession>
              <Modules>
                <Module hash="AA-BB-CC">
                  <Classes><Class><Methods>
                    <Method visited="false">
                      <MetadataToken>100663581</MetadataToken>
                      <SequencePoints>
                        <SequencePoint uspid="10" vc="0" sl="5" />
                        <SequencePoint uspid="11" vc="0" sl="6" />
                      </SequencePoints>
                      <BranchPoints>
                        <BranchPoint uspid="20" vc="0" sl="7" />
                      </BranchPoints>
                      <Summary numSequencePoints="2" visitedSequencePoints="0"
                               numBranchPoints="1" visitedBranchPoints="0"
                               sequenceCoverage="0" branchCoverage="0" />
                    </Method>
                  </Methods></Class></Classes>
                  <Summary numSequencePoints="2" visitedSequencePoints="0"
                           numBranchPoints="1" visitedBranchPoints="0"
                           sequenceCoverage="0" branchCoverage="0" />
                </Module>
              </Modules>
            </CoverageSession>
            """);
        return document.Root!.Element("Modules")!.Elements("Module").ToList();
    }

    private static string Dump(string moduleHash, IReadOnlyDictionary<string, long> points)
    {
        var modulesJson = JsonSerializer.Serialize(new Dictionary<string, object>
        {
            [moduleHash] = points
        });
        return JsonSerializer.Serialize(new
        {
            kind = "app-e2e-coverage-dump/1",
            test = "T",
            snapshot = JsonDocument.Parse($"{{\"modules\":{modulesJson}}}").RootElement
        });
    }

    private static XElement Point(XElement module, string element, string uspid) =>
        module.Descendants(element).Single(p => p.Attribute("uspid")?.Value == uspid);

    [Fact]
    public void Applies_sequence_branch_and_method_token_visits()
    {
        var modules = Modules();
        // Branch visits arrive as int.MinValue | uspid; here 20 | int.MinValue.
        var dump = Dump(Hash, new Dictionary<string, long>
        {
            ["10"] = 3,
            [(int.MinValue | 20).ToString()] = 2,
            ["100663581"] = 1
        });

        var applied = E2ECoverageApply.ApplyDumps(modules, [("t.json", dump)], out var stats);

        Assert.Equal(6, applied);
        Assert.Equal("3", Point(modules[0], "SequencePoint", "10").Attribute("vc")?.Value);
        Assert.Equal("2", Point(modules[0], "BranchPoint", "20").Attribute("vc")?.Value);
        Assert.Equal("true", modules[0].Descendants("Method").Single().Attribute("visited")?.Value);
        Assert.Equal(0, stats.IncompatibleDumps);
        Assert.Equal(0, stats.UnknownPointIds);
        Assert.Equal(1, stats.SequencePointsVisited);
        Assert.Equal(1, stats.BranchPointsVisited);
    }

    [Fact]
    public void Accumulates_hit_counts_across_duplicate_dumps()
    {
        var modules = Modules();
        var dump = Dump(Hash, new Dictionary<string, long> { ["10"] = 2 });

        E2ECoverageApply.ApplyDumps(modules, [("a.json", dump), ("b.json", dump)], out _);

        Assert.Equal("4", Point(modules[0], "SequencePoint", "10").Attribute("vc")?.Value);
    }

    [Fact]
    public void Leaves_unvisited_points_at_zero()
    {
        var modules = Modules();
        var dump = Dump(Hash, new Dictionary<string, long> { ["10"] = 1 });

        E2ECoverageApply.ApplyDumps(modules, [("t.json", dump)], out _);

        Assert.Equal("0", Point(modules[0], "SequencePoint", "11").Attribute("vc")?.Value);
    }

    [Fact]
    public void Counts_dumps_from_a_different_build_as_incompatible()
    {
        var modules = Modules();
        var dump = Dump("DE-AD-BE-EF", new Dictionary<string, long> { ["10"] = 9 });

        var applied = E2ECoverageApply.ApplyDumps(modules, [("stale.json", dump)], out var stats);

        Assert.Equal(0, applied);
        Assert.Equal(1, stats.IncompatibleDumps);
        Assert.Equal("0", Point(modules[0], "SequencePoint", "10").Attribute("vc")?.Value);
    }

    [Fact]
    public void Counts_dumps_without_a_snapshot_as_incompatible()
    {
        var modules = Modules();

        var applied = E2ECoverageApply.ApplyDumps(modules,
            [("bad.json", """{"kind":"app-e2e-coverage-dump/1"}""")], out var stats);

        Assert.Equal(0, applied);
        Assert.Equal(1, stats.IncompatibleDumps);
    }

    [Fact]
    public void Counts_point_ids_with_no_template_entry_as_unknown()
    {
        var modules = Modules();
        var dump = Dump(Hash, new Dictionary<string, long> { ["99999"] = 4 });

        var applied = E2ECoverageApply.ApplyDumps(modules, [("t.json", dump)], out var stats);

        Assert.Equal(0, applied);
        Assert.Equal(1, stats.UnknownPointIds);
        Assert.Equal(0, stats.IncompatibleDumps);
    }

    [Fact]
    public void Updates_summary_visited_counters()
    {
        var modules = Modules();
        var dump = Dump(Hash, new Dictionary<string, long>
        {
            ["10"] = 1,
            [(int.MinValue | 20).ToString()] = 1
        });

        E2ECoverageApply.ApplyDumps(modules, [("t.json", dump)], out _);
        E2ECoverageApply.UpdateModuleSummaries(modules);

        var summary = modules[0].Descendants("Summary").First();
        Assert.Equal("1", summary.Attribute("visitedSequencePoints")?.Value);
        Assert.Equal("1", summary.Attribute("visitedBranchPoints")?.Value);
        Assert.Equal("50", summary.Attribute("sequenceCoverage")?.Value);
    }
}
