using System.ComponentModel;
using BibleOnSite.Models;

namespace BibleOnSite.Tests.Models;

/// <summary>
/// <see cref="ParashaUnit"/> INotifyPropertyChanged surface: lazy-loaded
/// properties raise change notifications so the carousel rebinds, and the
/// offscreen flag's same-value early return suppresses duplicate events.
/// </summary>
public class ParashaUnitTests
{
    private static ParashaUnit CreateUnit() => new()
    {
        UnitId = 1,
        Slug = "1",
        SeferId = 1,
        SeferName = "בראשית",
        Order = 1,
        Heading = "בראשית",
        TorahRange = new ScriptureRange()
    };

    [Fact]
    public void PropertySetters_RaisePropertyChanged()
    {
        var unit = CreateUnit();
        var raised = new List<string>();
        unit.PropertyChanged += (_, e) => raised.Add(e.PropertyName!);

        unit.Rows = [ParashaDisplayItem.SectionHeader("תורה")];
        unit.TikkunPasukim = [new Pasuk { PasukNum = 1, Text = "א" }];
        unit.RangeLabel = "בראשית א";
        unit.IsOffscreenCarouselPage = false;

        raised.Should().Equal(
            nameof(ParashaUnit.Rows),
            nameof(ParashaUnit.TikkunPasukim),
            nameof(ParashaUnit.RangeLabel),
            nameof(ParashaUnit.IsOffscreenCarouselPage));
    }

    [Fact]
    public void IsOffscreenCarouselPage_SameValue_StaysSilent()
    {
        var unit = CreateUnit();
        var raised = new List<string?>();
        unit.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        // The flag already defaults to true — reassigning it must not
        // notify, or every carousel settle would storm the accessibility tree.
        unit.IsOffscreenCarouselPage = true;

        raised.Should().BeEmpty();
    }
}
