using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace BibleOnSite.Tests.Resources;

public class XamlStaticResourceTests
{
    private static readonly string AppRoot = FindAppRoot();

    private static readonly Regex ResourceRegex = new(@"StaticResource\s+(\w+)\s*\}");

    private static string FindAppRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null)
        {
            var candidate = Path.Combine(dir, "BibleOnSite");
            if (Directory.Exists(candidate) && File.Exists(Path.Combine(candidate, "BibleOnSite.csproj")))
            {
                return candidate;
            }

            var siblingCandidate = Path.Combine(Path.GetDirectoryName(dir)!, "BibleOnSite");
            if (Directory.Exists(siblingCandidate) && File.Exists(Path.Combine(siblingCandidate, "BibleOnSite.csproj")))
            {
                return siblingCandidate;
            }

            dir = Path.GetDirectoryName(dir);
        }

        throw new InvalidOperationException(
            "Could not locate BibleOnSite project root from " + AppContext.BaseDirectory);
    }

    private static HashSet<string> CollectDefinedKeys()
    {
        var keys = new HashSet<string>(StringComparer.Ordinal);

        var resourceFiles = new[]
        {
            Path.Combine(AppRoot, "Resources", "Styles", "Colors.xaml"),
            Path.Combine(AppRoot, "Resources", "Styles", "Styles.xaml"),
            Path.Combine(AppRoot, "App.xaml"),
        };

        XNamespace xNs = "http://schemas.microsoft.com/winfx/2009/xaml";

        foreach (var file in resourceFiles)
        {
            if (!File.Exists(file))
            {
                continue;
            }

            var doc = XDocument.Load(file);
            foreach (var el in doc.Descendants())
            {
                var keyAttr = el.Attribute(xNs + "Key");
                if (keyAttr != null)
                {
                    keys.Add(keyAttr.Value);
                }
            }
        }

        return keys;
    }

    private static IEnumerable<string> GetAllXamlFiles()
    {
        return Directory.EnumerateFiles(AppRoot, "*.xaml", SearchOption.AllDirectories);
    }

    private static HashSet<string> CollectLocalKeys(string filePath)
    {
        var keys = new HashSet<string>(StringComparer.Ordinal);
        XNamespace xNs = "http://schemas.microsoft.com/winfx/2009/xaml";
        var doc = XDocument.Load(filePath);
        foreach (var el in doc.Descendants())
        {
            var keyAttr = el.Attribute(xNs + "Key");
            if (keyAttr != null)
            {
                keys.Add(keyAttr.Value);
            }
        }
        return keys;
    }

    private static List<(string File, int Line, string Key)> FindUnresolvedReferences()
    {
        var globalKeys = CollectDefinedKeys();
        var unresolved = new List<(string File, int Line, string Key)>();

        foreach (var file in GetAllXamlFiles())
        {
            var localKeys = CollectLocalKeys(file);
            var lines = File.ReadAllLines(file);
            for (var i = 0; i < lines.Length; i++)
            {
                foreach (System.Text.RegularExpressions.Match match in ResourceRegex.Matches(lines[i]))
                {
                    var key = match.Groups[1].Value;
                    if (!globalKeys.Contains(key) && !localKeys.Contains(key))
                    {
                        unresolved.Add((File: Path.GetRelativePath(AppRoot, file), Line: i + 1, Key: key));
                    }
                }
            }
        }

        return unresolved;
    }

    [Fact]
    public void AllStaticResourceReferences_ShouldResolveToDefinedKeys()
    {
        var unresolved = FindUnresolvedReferences();

        unresolved.Should().BeEmpty(
            "all StaticResource references in XAML must resolve to a defined x:Key. " +
            "Unresolved references cause runtime XamlParseException crashes:\n" +
            string.Join("\n", unresolved.Select(u => $"  {u.File}:{u.Line} -> {{{u.Key}}}")));
    }

    [Fact]
    public void GrayScale_ShouldHaveAllMultiplesOf50()
    {
        var definedKeys = CollectDefinedKeys();
        var missingGrays = new List<string>();

        for (var n = 50; n <= 950; n += 50)
        {
            var key = $"Gray{n}";
            if (!definedKeys.Contains(key))
            {
                missingGrays.Add(key);
            }
        }

        missingGrays.Should().BeEmpty(
            "Colors.xaml should define Gray colors at every multiple of 50 (Gray50..Gray950)");
    }

    [Theory]
    [InlineData("Gray775")]
    [InlineData("Gray999")]
    [InlineData("NonExistentResource")]
    public void CollectDefinedKeys_ShouldNotContainArbitraryKeys(string key)
    {
        var definedKeys = CollectDefinedKeys();
        definedKeys.Should().NotContain(key,
            "only explicitly defined keys should resolve — " +
            "referencing {0} in XAML would crash the app at runtime", key);
    }
}
