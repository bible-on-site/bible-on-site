using BibleOnSite.Models;

namespace BibleOnSite.Tests.Models;

/// <summary>
/// MoedUnit rows (#3261): lazy row list change-notification, the header-row
/// pasuk defaults, and the section play button's value-changed contract.
/// </summary>
public class MoedUnitTests
{
    private static MoedUnit Moed() => new() { Id = 1, Slug = "tisha-bav", Name = "תשעה באב" };

    [Fact]
    public void Rows_Reassignment_NotifiesOnlyOnRealChange()
    {
        var moed = Moed();
        var notifications = new List<string>();
        moed.PropertyChanged += (_, e) => notifications.Add(e.PropertyName!);

        var rows = new List<MoedDisplayRow> { MoedDisplayRow.SectionHeader(1, "קריאה", "") };
        moed.Rows = rows;
        // The same list reference re-set is not a change — no second event.
        moed.Rows = rows;

        notifications.Should().Equal(nameof(MoedUnit.Rows));
    }

    [Fact]
    public void Rows_UnsubscribedSetter_StillStores()
    {
        var moed = Moed();

        moed.Rows = [MoedDisplayRow.SectionHeader(1, "קריאה", "")];

        moed.Rows.Should().ContainSingle();
    }

    [Fact]
    public void HeaderRows_ReportCanonicalZeroBounds()
    {
        var sectionHeader = MoedDisplayRow.SectionHeader(3, "הפטרה", "ישעיהו ס");
        var perekHeader = MoedDisplayRow.PerekHeader(3, "ישעיהו ס");

        // Headers carry no pasuk — the canonical keys stay at their 0 defaults
        // so commentary joins and selection lookups can never match them.
        sectionHeader.PasukNum.Should().Be(0);
        sectionHeader.PerekId.Should().Be(0);
        sectionHeader.IsPerekHeader.Should().BeFalse();
        perekHeader.PasukNum.Should().Be(0);
        perekHeader.PerekId.Should().Be(0);
        perekHeader.IsSectionHeader.Should().BeFalse();
    }

    [Fact]
    public void ShowPlayButton_Reassignment_NotifiesOnlyOnRealChange()
    {
        var header = MoedDisplayRow.SectionHeader(5, "קריאת התורה", "");
        var notifications = new List<string>();
        header.PropertyChanged += (_, e) => notifications.Add(e.PropertyName!);

        header.ShowPlayButton = true;
        // Re-setting the same flag is not a change — the binding stays quiet.
        header.ShowPlayButton = true;
        header.ShowPlayButton = false;

        notifications.Should().Equal(
            nameof(MoedDisplayRow.ShowPlayButton),
            nameof(MoedDisplayRow.ShowPlayButton));
    }
}
