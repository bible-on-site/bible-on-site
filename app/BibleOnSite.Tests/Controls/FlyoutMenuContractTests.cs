using System.Xml.Linq;

namespace BibleOnSite.Tests.Controls;

public class FlyoutMenuContractTests
{
    [Fact]
    public void Native_drawer_uses_the_website_group_order_and_copy_with_native_preferences()
    {
        var path = Path.GetFullPath(Path.Join(AppContext.BaseDirectory, "..", "..", "..", "..", "BibleOnSite", "AppShell.xaml"));
        var document = XDocument.Load(path);
        XNamespace maui = "http://schemas.microsoft.com/dotnet/2021/maui";
        XNamespace controls = "clr-namespace:BibleOnSite.Controls";
        var drawer = Assert.Single(document.Descendants(maui + "ScrollView"),
            element => (string?)element.Attribute("AutomationId") == "FlyoutScrollView");
        var rows = Assert.Single(drawer.Elements(maui + "VerticalStackLayout")).Elements()
            .Where(element => element.Name == maui + "Label" || element.Name == controls + "FlyoutMenuRow")
            .Select(element => (
                Id: (string?)element.Attribute("AutomationId"),
                Title: (string?)element.Attribute("Title") ?? (string?)element.Attribute("Text"),
                Subtitle: (string?)element.Attribute("Subtitle")));

        Assert.Equal(new (string?, string?, string?)[]
        {
            (null, "לימוד על הפרק", null),
            ("FlyoutAlHaperek", "על הפרק", "הלימוד בחלוקה המוכרת"),
            (null, "חלוקות נוספות", null),
            ("FlyoutMasora", "מסורה על הפרק", "חלוקת המסורה היהודית הקדומה"),
            ("FlyoutParasha", "פרשה על הפרק", "לימוד לפי סדר הפרשות"),
            ("FlyoutMoadim", "מועדים על הפרק", "לימוד במעגל השנה"),
            ("FlyoutAuthors", "הרבנים", "איתור מאמרים לפי המחברים"),
            (null, "אפשרויות לימוד נוספות", null),
            ("FlyoutDailyBulletin", "עלון יומי", "הפרק היומי והמאמרים ישירות אליכם"),
            (null, "כלי לימוד", null),
            ("FlyoutTanahpedia", "תנכפדיה", "אנציקלופדיה תנ\"כית"),
            ("FlyoutLearningCalendar", "לוח לימוד יומי", "לוח עזר פרקים לפי תאריך"),
            (null, "שונות", null),
            ("FlyoutTerms", "תנאי שימוש", "והצהרות פרטיות ונגישות"),
            ("FlyoutDonations", "תרומות", null),
            ("FlyoutContact", "צור קשר", null),
            ("FlyoutPreferences", "העדפות", "הגדרות משתמש"),
        }, rows);
    }
}
