using BibleOnSite.Helpers;
using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class PasukDisplayItemsTests
{
    private static Pasuk PasukOf(int num, string text) => new()
    {
        PasukNum = num,
        Text = text,
        Segments = [new PasukSegment { Type = SegmentType.Ktiv, Value = text }]
    };

    [Fact]
    public void Create_returns_empty_for_null_or_empty_input()
    {
        PasukDisplayItems.Create(null, repeatEachPasuk: false).Should().BeEmpty();
        PasukDisplayItems.Create([], repeatEachPasuk: true).Should().BeEmpty();
    }

    [Fact]
    public void Create_returns_one_item_per_pasuk_in_normal_mode()
    {
        var pesukim = new List<Pasuk> { PasukOf(1, "אחד"), PasukOf(2, "שניים") };

        var items = PasukDisplayItems.Create(pesukim, repeatEachPasuk: false);

        items.Should().HaveCount(2);
        items.Select(i => i.Pasuk).Should().Equal(pesukim);
        items.Should().OnlyContain(i => i.IsFirstCopy && !i.IsRepeatedCopy);
        items.Select(i => i.PasukNumHeb).Should().Equal("א", "ב");
    }

    [Fact]
    public void Create_repeats_each_pasuk_twice_in_shnayim_mikra_mode()
    {
        var pesukim = new List<Pasuk> { PasukOf(1, "אחד"), PasukOf(2, "שניים") };

        var items = PasukDisplayItems.Create(pesukim, repeatEachPasuk: true);

        items.Should().HaveCount(4);
        items.Select(i => i.PasukNum).Should().Equal(1, 1, 2, 2);
        items.Select(i => i.IsRepeatedCopy).Should().Equal(false, true, false, true);
    }

    [Fact]
    public void Create_marks_the_only_copy_as_the_last_copy_in_normal_mode()
    {
        var items = PasukDisplayItems.Create(
            [PasukOf(1, "אחד"), PasukOf(2, "שניים")], repeatEachPasuk: false);

        // A single rendered copy is both first and last: it hosts the perushim.
        items.Should().OnlyContain(i => i.IsLastCopy);
    }

    [Fact]
    public void Create_puts_the_perush_host_after_both_copies_in_shnayim_mikra_mode()
    {
        // #2403: the rendered sequence per pasuk is מקרא, מקרא, פירוש — the
        // last copy carries the commentary, never the row between the copies.
        var pasuk1 = PasukOf(1, "אחד");
        pasuk1.VisiblePerushNotes.Add(new PerushNoteDisplay { PerushName = "רש\"י" });
        var pasuk2 = PasukOf(2, "שניים");
        pasuk2.VisiblePerushNotes.Add(new PerushNoteDisplay { PerushName = "רמב\"ן" });

        var items = PasukDisplayItems.Create([pasuk1, pasuk2], repeatEachPasuk: true);

        items.Select(i => i.IsLastCopy).Should().Equal(false, true, false, true);
        items.Select(i => i.PasukNum).Should().Equal(1, 1, 2, 2);
        // Only the last copy of each pair binds notes: the row between the
        // scripture copies stays empty rather than hiding dead duplicates.
        items.Select(i => i.PerushNotes.Count).Should().Equal(0, 1, 0, 1);
        items[1].PerushNotes[0].PerushName.Should().Be("רש\"י");
        items[3].PerushNotes[0].PerushName.Should().Be("רמב\"ן");
    }

    [Fact]
    public void Create_shares_one_marker_per_pair_on_the_first_copy_only()
    {
        var pesukim = new List<Pasuk> { PasukOf(1, "אחד") };

        var items = PasukDisplayItems.Create(pesukim, repeatEachPasuk: true);

        items[0].PasukNumHeb.Should().Be("א");
        items[1].PasukNumHeb.Should().BeEmpty();
    }

    [Fact]
    public void Create_keeps_both_copies_bound_to_the_same_logical_pasuk()
    {
        var pasuk = PasukOf(7, "שבע");

        var items = PasukDisplayItems.Create([pasuk], repeatEachPasuk: true);

        items[0].Pasuk.Should().BeSameAs(pasuk);
        items[1].Pasuk.Should().BeSameAs(pasuk);
        items[0].PasukNum.Should().Be(items[1].PasukNum);
    }

    [Fact]
    public void Create_stamps_the_base_sizes_at_the_default_font_factor()
    {
        var items = PasukDisplayItems.Create([PasukOf(1, "א")], repeatEachPasuk: false);

        items[0].FontSize.Should().Be(PasukDisplayItems.PasukFontSizeBase);
        items[0].MarkerFontSize.Should().Be(PasukDisplayItems.PasukMarkerFontSizeBase);
    }

    [Fact]
    public void Create_scales_text_and_marker_sizes_with_the_font_factor()
    {
        var items = PasukDisplayItems.Create(
            [PasukOf(1, "א"), PasukOf(2, "ב")], repeatEachPasuk: true, fontFactor: 1.5);

        // Both copies of every pasuk keep the same configured size (#2070).
        items.Should().OnlyContain(i =>
            Math.Abs(i.FontSize - 27) < 0.001 && Math.Abs(i.MarkerFontSize - 24) < 0.001);
        items.Select(i => i.PasukNum).Should().Equal(1, 1, 2, 2);
    }

    [Fact]
    public void Create_rebuilds_the_same_sizes_on_every_toggle_cycle()
    {
        var pesukim = new List<Pasuk> { PasukOf(1, "אחד"), PasukOf(2, "שניים") };

        var off = PasukDisplayItems.Create(pesukim, repeatEachPasuk: false, fontFactor: 1.25);
        var on = PasukDisplayItems.Create(pesukim, repeatEachPasuk: true, fontFactor: 1.25);
        var offAgain = PasukDisplayItems.Create(pesukim, repeatEachPasuk: false, fontFactor: 1.25);

        off.Concat(on).Should().OnlyContain(i => Math.Abs(i.FontSize - 22.5) < 0.001);
        offAgain.Select(i => i.FontSize).Should().Equal(off.Select(i => i.FontSize));
    }
}
