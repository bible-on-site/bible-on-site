using System.Xml.Linq;
using FluentAssertions;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// #2575: the Parasha reader's expanded menu must carry a discoverable
/// פרשת השבוע action — a calendar-resolved weekly-reading shortcut wired
/// through <c>LoadWeeklyParashaCommand</c>, with an accessible name, placed
/// like the regular reader's daily-perek satellite.
/// </summary>
public class ParashaMenuWeeklyActionTests
{
    private static readonly string AppRoot = FindAppRoot();

    [Fact]
    public void WeeklyParashaButton_IsAWiredAccessibleSatellite()
    {
        XNamespace p = "http://schemas.microsoft.com/dotnet/2021/maui";
        var doc = XDocument.Load(Path.Join(AppRoot, "Pages", "ParashaPage.xaml"));

        var button = doc.Descendants(p + "Button")
            .FirstOrDefault(e => (string?)e.Attribute("AutomationId") == "WeeklyParashaButton");
        button.Should().NotBeNull("the menu must expose the פרשת השבוע action");

        button!.Attribute("Command")?.Value.Should().Contain("LoadWeeklyParashaCommand",
            "the action routes through the view-model's calendar-resolved command");
        button.Attribute("SemanticProperties.Description")?.Value
            .Should().Be("פרשת השבוע", "the action keeps an accessible Hebrew name");
        button.Attribute("Clicked")?.Value.Should().Be("OnMenuItemClicked",
            "activation closes the expanded menu like the sibling satellites");
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
            dir = Path.GetDirectoryName(dir);
        }
        throw new InvalidOperationException("BibleOnSite project root not found");
    }
}
