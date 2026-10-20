using BibleOnSite.Models;

namespace BibleOnSite.Tests.Models;

/// <summary>
/// פרשה על הפרק display rows: header rows expose empty pasuk passthroughs
/// so the row template's typed bindings never see a nullable chain, and
/// pasuk rows mirror their <see cref="PasukDisplayItem"/> exactly.
/// </summary>
public class ParashaDisplayItemTests
{
    private static Pasuk PasukOf(int num) => new()
    {
        PasukNum = num,
        Text = $"pasuk {num}",
        Segments = [new PasukSegment { Type = SegmentType.Ktiv, Value = $"pasuk {num}" }]
    };

    [Fact]
    public void Headers_ExposeEmptyPasukPassthroughs()
    {
        foreach (var header in new[] { ParashaDisplayItem.SectionHeader("תורה"), ParashaDisplayItem.PerekHeader("בראשית א") })
        {
            header.PasukNum.Should().Be(0);
            header.Pasuk.Should().BeNull();
            header.PasukFormattedText.Should().BeNull();
            header.PasukNumHeb.Should().BeEmpty();
            header.PasukFontSize.Should().Be(0);
            header.PasukMarkerFontSize.Should().Be(0);
            header.IsLastCopy.Should().BeFalse();
            header.PerushNotes.Should().BeNull();
            header.Display.Should().BeNull();
            header.PerekId.Should().Be(0);
        }
    }

    [Fact]
    public void PasukItem_MirrorsTheWrappedDisplayItem()
    {
        var pasuk = PasukOf(3);
        pasuk.PerushNotes = [new PerushNoteDisplay { PerushId = 1, PerushName = "רשי" }];
        var display = new PasukDisplayItem(pasuk, isRepeatedCopy: true, isLastCopy: true, fontSize: 18, markerFontSize: 16);

        var row = ParashaDisplayItem.PasukItem(display, perekId: 7);

        row.PerekId.Should().Be(7);
        row.PasukNum.Should().Be(display.PasukNum);
        row.Pasuk.Should().BeSameAs(pasuk);
        row.PasukFormattedText.Should().BeSameAs(pasuk.FormattedText);
        row.PasukNumHeb.Should().Be(display.PasukNumHeb);
        row.PasukFontSize.Should().Be(18);
        row.PasukMarkerFontSize.Should().Be(16);
        row.IsLastCopy.Should().BeTrue();
        row.PerushNotes.Should().ContainSingle().Which.PerushId.Should().Be(1);
        row.IsSectionHeader.Should().BeFalse();
        row.IsPerekHeader.Should().BeFalse();
    }
}
