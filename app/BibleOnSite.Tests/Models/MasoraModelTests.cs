using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.Tests.Models;

public class MasoraModelTests
{
    [Fact]
    public void ClosingBreakLabel_MapsMasoreticBreakKinds()
    {
        var unit = new MasoraUnit { UnitId = 1, Slug = "1", SeferName = "ספר", Heading = "כותרת" };

        // Sefer-final units close on the sefer end, not on a break marker.
        unit.ClosingBreak.Should().BeNull();
        unit.ClosingBreakLabel.Should().BeEmpty();
        unit.HasClosingBreak.Should().BeFalse();

        unit.ClosingBreak = "ptuha";
        unit.ClosingBreakLabel.Should().Be("פרשה פתוחה");
        unit.HasClosingBreak.Should().BeTrue();

        unit.ClosingBreak = "stuma";
        unit.ClosingBreakLabel.Should().Be("פרשה סתומה");
        unit.HasClosingBreak.Should().BeTrue();

        // Unknown/empty values fall back to no label.
        unit.ClosingBreak = "other";
        unit.ClosingBreakLabel.Should().BeEmpty();
    }

    [Fact]
    public void Rows_Setter_RaisesPropertyChangedForCarouselRebind()
    {
        var unit = new MasoraUnit { UnitId = 1, Slug = "1", SeferName = "ספר", Heading = "כותרת" };
        var raised = new List<string?>();
        unit.PropertyChanged += (_, e) => raised.Add(e.PropertyName);
        var rows = new List<MasoraPasukRow>();

        unit.Rows = rows;

        unit.Rows.Should().BeSameAs(rows);
        raised.Should().Equal(nameof(MasoraUnit.Rows));
    }

    [Fact]
    public void PasukRow_ExposesPasukDisplayData()
    {
        var pasuk = new Pasuk { PasukNum = 3, Text = "א ב", Segments = new List<PasukSegment>() };
        var row = new MasoraPasukRow(pasuk, 2, 20);

        row.Pasuk.Should().BeSameAs(pasuk);
        row.PerekId.Should().Be(2);
        row.PasukNum.Should().Be(3);
        row.FontSize.Should().Be(20);
    }

    [Fact]
    public void AppRoutes_Masora_IsFlyoutRoute()
    {
        AppRoutes.Masora.Should().Be("MasoraPage");
        AppRoutes.FlyoutPage(AppRoutes.Masora).Should().Be("//PerekPage/MasoraPage");
    }
}
