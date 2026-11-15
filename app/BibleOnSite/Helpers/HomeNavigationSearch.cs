using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.Helpers;

/// <summary>Local navigation search stays available without a content index or connection.</summary>
public static class HomeNavigationSearch
{
    public static string IndexAction => "@index";

    private static readonly NavigationSearchItem[] Destinations =
    [
        new("לוח שנה", "לוח הלימוד והפרק לפי תאריך", AppRoutes.LearningCalendar, "calendar date תאריך לוח לימוד יומי"),
        new("מסורה", "חלוקה מסורתית", AppRoutes.Masora, "masora פרשיות חלוקה מסורתית"),
        new("רבנים וכותבים", "לימוד ומאמרים מזוויות נוספות", AppRoutes.Authors, "authors רבנים כותבים מאמרים"),
        new("אינדקס התנ\"ך", "בחירת ספר ופרק", IndexAction, "index bible ספר פרק חיפוש אינדקס"),
        new("העדפות", "הגדרות התצוגה והלימוד", AppRoutes.Preferences, "settings preferences הגדרות גופן תצוגה"),
        new("תנכפדיה", "אנשים, מקומות ומושגים", AppRoutes.Tanahpedia, "tanahpedia encyclopedia אנציקלופדיה מפה מקומות"),
        new("פרשת השבוע", "פרשות התורה", AppRoutes.ParashaList, "parasha פרשה שבוע תורה"),
        new("מועדים", "לימוד לחגים ולמועדים", AppRoutes.Moadim, "holidays חגים חג מועדים"),
        new("עלון יומי", "דף הלימוד היומי", AppRoutes.DailyBulletin, "bulletin עלון דף יומי"),
        new("צור קשר", "יצירת קשר עם צוות המיזם", AppRoutes.Contact, "contact משוב עזרה תמיכה"),
        new("תרומות", "תמיכה במיזם", AppRoutes.Donations, "donate תרומה תמיכה במיזם"),
        new("תנאי שימוש", "תנאי השימוש והפרטיות", AppRoutes.Terms, "terms privacy פרטיות תנאי שימוש"),
        new("בית", "מסך הבית והפרק היומי", $"//{AppRoutes.Perek}", "home תפריט ראשי דף הבית")
    ];

    public static IReadOnlyList<NavigationSearchItem> Find(string query)
    {
        var tokens = SearchText.Tokens(query);
        return Destinations.Where(item =>
        {
            var haystack = SearchText.Normalize($"{item.Title} {item.Subtitle} {item.SearchTerms}");
            return tokens.All(token => haystack.Contains(token, StringComparison.Ordinal));
        }).ToArray();
    }
}
