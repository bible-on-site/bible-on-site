using System.Xml.Linq;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// #3274: the terms page must carry the copyright/provenance best-efforts
/// notice with the transparent report-handling commitment — qualified
/// provenance wording, the public reporting address, updates at receipt /
/// status changes / resolution (retention, removal or another outcome),
/// and the no-admission reservation. The guard pins the section's presence
/// and that the reporting email is a working tappable action.
/// </summary>
public class TosPageContentGuardTests
{
    private static readonly string AppRoot = FindAppRoot();

    private static string TosXaml() =>
        File.ReadAllText(Path.Join(AppRoot, "Pages", "TosPage.xaml"));

    private static string TosCodeBehind() =>
        File.ReadAllText(Path.Join(AppRoot, "Pages", "TosPage.xaml.cs"));

    [Fact]
    public void TosPage_StatesQualifiedProvenanceAndCopyrightBestEfforts()
    {
        var xaml = TosXaml();
        Assert.Contains("זכויות יוצרים ופניות בנושא תוכן", xaml);
        foreach (var phrase in new[]
        {
            "למיטב ידיעתנו",
            "אישורים שקיבלנו מהרבנים המחברים",
            "בכפוף להיקף ההרשאה",
            "שימוש הוגן",
            "בהתאם לנסיבות העניין",
            "נכתבו במלואם על ידינו באופן מקורי",
            "אינו התחייבות",
        })
        {
            Assert.Contains(phrase, xaml);
        }
    }

    [Fact]
    public void TosPage_PromisesTransparentReportHandlingAtEveryStage()
    {
        var xaml = TosXaml();
        foreach (var phrase in new[]
        {
            "אישור על קבלת הפנייה",
            "עדכונים על הטיפול ועל כל שינוי בסטטוס",
            "עדכון עם סיום הטיפול",
            "השארת הפריט, הסרתו או כל סיום אחר",
        })
        {
            Assert.Contains(phrase, xaml);
        }
        // No-admission / reservation clause — without a blanket immunity claim.
        Assert.Contains("אינם מהווים, כשלעצמם, הודאה", xaml);
        Assert.Contains("ויתור על טענה, זכות או הגנה", xaml);
        Assert.DoesNotContain("אין עלינו כל אחריות", xaml);
    }

    [Fact]
    public void TosPage_WiresACallableReportingEmail()
    {
        var xaml = XDocument.Parse(TosXaml());
        var link = Assert.Single(xaml.Descendants()
            .Where(e => e.Attribute("AutomationId")?.Value == "CopyrightEmailLink"));
        Assert.Equal("tanah.site@gmail.com", link.Attribute("Text")?.Value);
        Assert.Contains(link.Descendants(),
            e => e.Attribute("Tapped")?.Value == "OnCopyrightEmailTapped");
        Assert.Contains("OnCopyrightEmailTapped", TosCodeBehind());
        Assert.Contains("CopyrightReport.OpenEmailAsync(Launcher.Default, ShellAppNavigator.Instance)", TosCodeBehind());
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
