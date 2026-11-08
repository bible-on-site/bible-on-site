using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

public class SearchSelectionSummaryTests
{
    [Fact]
    public void KindSummary_UsesDefaultUntilExplicit_AndCountsAdditionalChoices()
    {
        SearchSelectionSummary.Describe(["רב", "פרק"], "מה לחפש", false).Should().Be("מה לחפש");
        SearchSelectionSummary.Describe(["פרק"], "מה לחפש", true).Should().Be("פרק");
        SearchSelectionSummary.Describe(["רב", "פרק", "תוכן פסוק"], "מה לחפש", true).Should().Be("רב +2");
    }

    [Fact]
    public void BookSummary_RecognizesAnEntireSection_AndCountsPartialSelections()
    {
        (int, string)[] torah = [(1, "בראשית"), (2, "שמות"), (3, "ויקרא"), (4, "במדבר"), (5, "דברים")];
        SearchSelectionSummary.Books(torah, false).Should().Be("היכן לחפש");
        SearchSelectionSummary.Books(torah, true).Should().Be("תורה");
        SearchSelectionSummary.Books(torah[..2], true).Should().Be("בראשית +1");
        SearchSelectionSummary.Books(torah[..1], true).Should().Be("בראשית");
        SearchSelectionSummary.Books([], true).Should().Be("ללא בחירה");
    }
}
