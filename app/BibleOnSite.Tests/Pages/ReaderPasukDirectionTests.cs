using System.Xml.Linq;
using FluentAssertions;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// #2964: all three readers render pesukim through the shared
/// <c>PasukTextLabel</c> with an explicit RTL flow direction, so the
/// iOS/MacCatalyst handlers can pin a deterministic paragraph base writing
/// direction — a "natural" one resolves from the device locale and flushes
/// the last/short lines of a justified pasuk left on English devices (the
/// reported masora left-alignment). Pinning the three templates keeps a
/// future reader edit from silently reintroducing a plain Label or a
/// dropped direction; the marker-less masora rows get the same contract as
/// the perek/parasha rows without needing pasuk numbers of their own.
/// </summary>
public class ReaderPasukDirectionTests
{
    private static readonly string AppRoot = FindAppRoot();
    private static readonly XNamespace Controls = "clr-namespace:BibleOnSite.Controls";

    public static TheoryData<string> ReaderPages => new()
    {
        "PerekPage.xaml",
        "ParashaPage.xaml",
        "MasoraPage.xaml",
    };

    [Theory]
    [MemberData(nameof(ReaderPages))]
    public void PasukText_UsesTheSharedRtlPasukTextLabel(string pageName)
    {
        var doc = XDocument.Load(Path.Join(AppRoot, "Pages", pageName));
        var pasukTexts = doc.Descendants()
            .Where(e => (string?)e.Attribute("AutomationId") == "PasukText")
            .ToList();

        pasukTexts.Should().NotBeEmpty($"{pageName} must render pesukim");
        foreach (var label in pasukTexts)
        {
            label.Name.Should().Be(Controls + "PasukTextLabel",
                $"{pageName} pesukim share the scripture label across readers");
            ((string?)label.Attribute("FlowDirection")).Should().Be("RightToLeft",
                $"{pageName} pesukim declare RTL for a deterministic paragraph direction");
        }
    }

    private static string FindAppRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null)
        {
            var candidate = Path.Join(dir, "BibleOnSite");
            if (Directory.Exists(candidate) && File.Exists(Path.Join(candidate, "BibleOnSite.csproj")))
            {
                return candidate;
            }

            var siblingCandidate = Path.Join(Path.GetDirectoryName(dir)!, "BibleOnSite");
            if (Directory.Exists(siblingCandidate) && File.Exists(Path.Join(siblingCandidate, "BibleOnSite.csproj")))
            {
                return siblingCandidate;
            }

            dir = Path.GetDirectoryName(dir);
        }

        throw new InvalidOperationException(
            "Could not locate BibleOnSite project root from " + AppContext.BaseDirectory);
    }
}
