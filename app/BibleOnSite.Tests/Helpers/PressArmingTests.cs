using BibleOnSite.Helpers;
using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class PressArmingTests
{
    private static Pasuk PasukOf(int num) => new()
    {
        PasukNum = num,
        Text = $"pasuk {num}",
        Segments = [new PasukSegment { Type = SegmentType.Ktiv, Value = $"pasuk {num}" }]
    };

    private static Perek CreatePerek(int perekId, params Pasuk[] pasukim) => new()
    {
        PerekId = perekId,
        PerekNumber = perekId,
        SeferId = 1,
        SeferName = "בראשית",
        Date = "2026-01-01",
        HebDate = "א טבת",
        SeferTanahUsName = "Bereshit",
        Tseit = "17:00",
        Pasukim = pasukim.ToList()
    };

    [Fact]
    public void IsCandidate_returns_true_for_the_current_perek_itself()
    {
        // The perek header label and the tikkun flow bind the carousel's Perek
        // item — the only contexts that actually arm today.
        var perek = CreatePerek(1, PasukOf(1));

        PressArming.IsCandidate(perek, perek).Should().BeTrue();
    }

    [Fact]
    public void IsCandidate_returns_false_for_another_perek_instance()
    {
        // Adjacent carousel pages bind different Perek objects; an equal id
        // must still not match — arming is by reference.
        var current = CreatePerek(1, PasukOf(1));
        var adjacent = CreatePerek(1, PasukOf(1));

        PressArming.IsCandidate(adjacent, current).Should().BeFalse();
    }

    [Fact]
    public void IsCandidate_returns_false_for_pasuk_rows_bound_to_PasukDisplayItem()
    {
        // Pasuk rows bind PasukDisplayItem, never Pasuk — they receive Down
        // through their own native Touch handler and must not arm here.
        var pasuk = PasukOf(1);
        var perek = CreatePerek(1, pasuk);
        var row = new PasukDisplayItem(pasuk, isRepeatedCopy: false, isLastCopy: true, fontSize: 18, markerFontSize: 16);

        PressArming.IsCandidate(row, perek).Should().BeFalse();
    }

    [Fact]
    public void IsCandidate_returns_true_for_a_pasuk_of_the_current_perek()
    {
        var pasuk = PasukOf(3);
        var perek = CreatePerek(1, PasukOf(1), PasukOf(2), pasuk);

        PressArming.IsCandidate(pasuk, perek).Should().BeTrue();
    }

    [Fact]
    public void IsCandidate_returns_false_for_a_pasuk_of_another_perek()
    {
        var foreignPasuk = PasukOf(9);
        var perek = CreatePerek(1, PasukOf(1), PasukOf(2));
        var otherPerek = CreatePerek(2, foreignPasuk);

        PressArming.IsCandidate(foreignPasuk, perek).Should().BeFalse();
        PressArming.IsCandidate(foreignPasuk, otherPerek).Should().BeTrue();
    }

    [Theory]
    [InlineData("a string context")]
    [InlineData(42)]
    public void IsCandidate_returns_false_for_unrelated_contexts(object bindingContext)
    {
        var perek = CreatePerek(1, PasukOf(1));

        PressArming.IsCandidate(bindingContext, perek).Should().BeFalse();
    }

    [Fact]
    public void IsCandidate_returns_false_for_null_context()
    {
        var perek = CreatePerek(1, PasukOf(1));

        PressArming.IsCandidate(null, perek).Should().BeFalse();
    }

    private static ParashaUnit CreateUnit(int unitId) => new()
    {
        UnitId = unitId,
        Slug = unitId.ToString(),
        SeferId = 1,
        SeferName = "בראשית",
        Order = unitId,
        Heading = "בראשית",
        TorahRange = new ScriptureRange()
    };

    [Fact]
    public void IsCandidate_returns_true_only_for_the_current_parasha_unit()
    {
        // The פרשה reader's תיקון flow binds the carousel's ParashaUnit —
        // arming matches the live unit by reference, never an equal id.
        var current = CreateUnit(1);
        var adjacent = CreateUnit(1);
        var row = ParashaDisplayItem.SectionHeader("תורה");

        PressArming.IsCandidate(current, current).Should().BeTrue();
        PressArming.IsCandidate(adjacent, current).Should().BeFalse();
        PressArming.IsCandidate(row, current).Should().BeFalse();
        PressArming.IsCandidate(null, current).Should().BeFalse();
    }
}
