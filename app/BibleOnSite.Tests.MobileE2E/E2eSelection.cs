using System.Text.Json;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// Runtime view of the e2e-impact selection manifest (#2085). The xunit query
// language cannot express an arbitrary FullyQualifiedName set — path segments
// take wildcards but never OR — so the manifest's selected list narrows the
// run inside the test process instead: an unselected test skips in
// InitializeAsync before it touches the device session. An unset
// MOBILE_E2E_SELECTION or a selectAll manifest leaves every test runnable, and
// the nuke target refuses a manifest that selects nothing, so reaching a
// device test with an empty selection means the manifest lied — skip it too
// rather than silently running a zero-coverage suite.
internal static class E2eSelection
{
    private static readonly Lazy<HashSet<string>?> _selected = new(Load);

    public static bool IsExcluded(ITestContext context)
    {
        var selected = _selected.Value;
        var test = context.Test;
        if (selected == null || test?.TestCase is not { } testCase)
        {
            return false;
        }
        // Only suite tests belong to the manifest; harness unit tests run
        // through the same class but carry Category=Unit instead.
        var traits = test.Traits;
        if (!traits.TryGetValue("Category", out var categories) || !categories.Contains("MobileE2E"))
        {
            return false;
        }
        var id = $"{testCase.TestClassName}.{testCase.TestMethodName}";
        return !selected.Contains(id);
    }

    private static HashSet<string>? Load()
    {
        var path = Environment.GetEnvironmentVariable("MOBILE_E2E_SELECTION");
        if (string.IsNullOrEmpty(path))
        {
            return null;
        }
        using var manifest = JsonDocument.Parse(File.ReadAllText(path));
        var root = manifest.RootElement;
        if (root.TryGetProperty("selectAll", out var flag) && flag.GetBoolean())
        {
            return null;
        }
        var ids = new HashSet<string>();
        if (root.TryGetProperty("selected", out var selected) && selected.ValueKind == JsonValueKind.Array)
        {
            foreach (var entry in selected.EnumerateArray())
            {
                if (entry.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String)
                {
                    ids.Add(id.GetString()!);
                }
            }
        }
        return ids;
    }
}
