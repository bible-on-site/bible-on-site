using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Tests.Helpers;

public class TanahpediaOccurrencesTests
{
    private static Pasuk PasukWithSegments(params string[] words) => new()
    {
        PasukNum = 1,
        Text = string.Join(" ", words),
        Segments = words.Select(word => new PasukSegment
        {
            Type = SegmentType.Qri,
            Value = word,
        }).ToList(),
    };

    private static List<string> Texts(FormattedString formatted) =>
        formatted.Spans.Select(span => span.Text).ToList();

    private static List<bool> BoldMask(FormattedString formatted) =>
        formatted.Spans.Select(span => span.FontAttributes == FontAttributes.Bold).ToList();

    [Fact]
    public void GroupRanges_MergesRowsOnTheSamePasuk()
    {
        var groups = TanahpediaOccurrences.GroupRanges(
        [
            new TanahpediaEntryOccurrence { PerekId = 250, PasukNumber = 3, SegmentStart = 1, SegmentEnd = 2 },
            new TanahpediaEntryOccurrence { PerekId = 250, PasukNumber = 1 },
            new TanahpediaEntryOccurrence { PerekId = 250, PasukNumber = 3, SegmentStart = 4, SegmentEnd = 4 },
        ]);

        groups.Should().HaveCount(2);
        groups[0].PasukNumber.Should().Be(1);
        groups[0].Ranges.Should().ContainSingle();
        groups[1].PasukNumber.Should().Be(3);
        groups[1].Ranges.Should().Equal((1, 2), (4, 4));
    }

    [Fact]
    public void FormatVerse_NullRange_BoldsWholePasuk()
    {
        var pasuk = PasukWithSegments("א", "ב", "ג");

        var formatted = TanahpediaOccurrences.FormatVerse(pasuk, [(null, null)], pasuk.Text);

        Texts(formatted).Should().Equal("א ", "ב ", "ג");
        BoldMask(formatted).Should().AllBeEquivalentTo(true);
    }

    [Fact]
    public void FormatVerse_BoundsOnlyCitedSegments()
    {
        var pasuk = PasukWithSegments("א", "ב", "ג", "ד");

        var formatted = TanahpediaOccurrences.FormatVerse(pasuk, [(1, 2)], pasuk.Text);

        // Spans: plain "א ", bold "ב ", bold "ג ", plain "ד".
        Texts(formatted).Should().Equal("א ", "ב ", "ג ", "ד");
        BoldMask(formatted).Should().Equal(false, true, true, false);
    }

    [Fact]
    public void FormatVerse_MultipleRanges_BoldsUnion()
    {
        var pasuk = PasukWithSegments("א", "ב", "ג", "ד", "ה");

        var formatted = TanahpediaOccurrences.FormatVerse(pasuk, [(0, 0), (4, 4)], pasuk.Text);

        Texts(formatted).Should().Equal("א ", "ב ג ד ", "ה");
        BoldMask(formatted).Should().Equal(true, false, true);
    }

    [Fact]
    public void FormatVerse_NoSpaceAfterMaqaf()
    {
        var pasuk = PasukWithSegments("בֵּית־", "לֶחֶם", "שלום");

        var formatted = TanahpediaOccurrences.FormatVerse(pasuk, [(null, null)], pasuk.Text);

        Texts(formatted).Should().Equal("בֵּית־", "לֶחֶם ", "שלום");
    }

    [Fact]
    public void FormatVerse_ParshaMarkersAreSkipped()
    {
        var pasuk = new Pasuk
        {
            PasukNum = 1,
            Text = "א ב",
            Segments =
            [
                new PasukSegment { Type = SegmentType.Qri, Value = "א" },
                new PasukSegment { Type = SegmentType.Ptuha },
                new PasukSegment { Type = SegmentType.Qri, Value = "ב" },
            ],
        };

        var formatted = TanahpediaOccurrences.FormatVerse(pasuk, [(null, null)], pasuk.Text);

        Texts(formatted).Should().Equal("א ", "ב");
        formatted.Spans.Should().NotContain(span => span.Text.Contains("{פ}"));
    }

    [Fact]
    public void FormatVerse_QriDifferent_WrapsInParens()
    {
        var pasuk = new Pasuk
        {
            PasukNum = 1,
            Text = "א (קרי)",
            Segments =
            [
                new PasukSegment { Type = SegmentType.Qri, Value = "א" },
                new PasukSegment { Type = SegmentType.Qri, Value = "קרי", PairedOffset = 1 },
                new PasukSegment { Type = SegmentType.Ktiv, Value = "כתיב", PairedOffset = -1 },
            ],
        };

        var formatted = TanahpediaOccurrences.FormatVerse(pasuk, [(null, null)], pasuk.Text);

        var texts = Texts(formatted);
        texts.Should().Contain(text => text.Contains("(קרי)"));
    }

    [Fact]
    public void FormatVerse_NoSegments_FallsBackToPlainText()
    {
        var formatted = TanahpediaOccurrences.FormatVerse(null, [(0, 1)], "פסוק מלא");

        Texts(formatted).Should().Equal("פסוק מלא");
        formatted.Spans[0].FontAttributes.Should().Be(FontAttributes.None);
    }

    [Fact]
    public void FormatVerse_EmptyRanges_FallsBackToPlainText()
    {
        var pasuk = PasukWithSegments("א", "ב");

        var formatted = TanahpediaOccurrences.FormatVerse(pasuk, [], pasuk.Text);

        Texts(formatted).Should().Equal("א ב");
    }
}
