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
}
