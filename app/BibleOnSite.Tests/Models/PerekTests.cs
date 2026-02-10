using System.ComponentModel;
using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Models;

public class PerekTests
{
    [Fact]
    public void Perek_ShouldHaveCorrectDefaults()
    {
        var perek = new Perek
        {
            Date = "2026-01-20",
            HebDate = "טבת",
            SeferName = "בראשית",
            SeferTanahUsName = "Genesis",
            Tseit = "17:30"
        };

        perek.PerekId.Should().Be(0);
        perek.PerekNumber.Should().Be(0);
        perek.SeferId.Should().Be(0);
        perek.Additional.Should().BeNull();
        perek.HasRecording.Should().BeFalse();
        perek.Header.Should().BeEmpty();
        perek.HebDateNumeric.Should().Be(0);
        perek.ArticlesCount.Should().Be(0);
        perek.Pasukim.Should().BeEmpty();
    }

    [Fact]
    public void Perek_ShouldBeFullySettable()
    {
        var pasukim = new List<Pasuk>
        {
            new() { PasukNum = 1, Text = "בראשית ברא" },
            new() { PasukNum = 2, Text = "והארץ היתה" }
        };

        var perek = new Perek
        {
            PerekId = 1,
            PerekNumber = 1,
            Additional = null,
            Date = "2026-01-20",
            HebDate = "כ טבת תשפו",
            HebDateNumeric = 57860120,
            HasRecording = true,
            Header = "בראשית א",
            SeferId = 1,
            SeferName = "בראשית",
            SeferTanahUsName = "Genesis",
            Tseit = "17:30:00",
            ArticlesCount = 5,
            Pasukim = pasukim
        };

        perek.PerekId.Should().Be(1);
        perek.PerekNumber.Should().Be(1);
        perek.Additional.Should().BeNull();
        perek.Date.Should().Be("2026-01-20");
        perek.HebDate.Should().Be("כ טבת תשפו");
        perek.HebDateNumeric.Should().Be(57860120);
        perek.HasRecording.Should().BeTrue();
        perek.Header.Should().Be("בראשית א");
        perek.SeferId.Should().Be(1);
        perek.SeferName.Should().Be("בראשית");
        perek.SeferTanahUsName.Should().Be("Genesis");
        perek.Tseit.Should().Be("17:30:00");
        perek.ArticlesCount.Should().Be(5);
        perek.Pasukim.Should().HaveCount(2);
    }

    [Fact]
    public void Perek_WithAdditional_ShouldStoreCorrectly()
    {
        var perek = new Perek
        {
            PerekId = 200,
            PerekNumber = 5,
            Additional = 1,
            Date = "2026-06-15",
            HebDate = "סיון",
            SeferId = 8,
            SeferName = "שמואל",
            SeferTanahUsName = "1 Samuel",
            Tseit = "20:00"
        };

        perek.Additional.Should().Be(1);
        perek.SeferName.Should().Be("שמואל");
    }

    [Fact]
    public void Perek_Pasukim_ShouldBeModifiable()
    {
        var perek = new Perek
        {
            Date = "2026-01-20",
            HebDate = "טבת",
            SeferName = "בראשית",
            SeferTanahUsName = "Genesis",
            Tseit = "17:30"
        };

        perek.Pasukim.Add(new Pasuk { PasukNum = 1, Text = "Test" });
        perek.Pasukim.Add(new Pasuk { PasukNum = 2, Text = "Test2" });

        perek.Pasukim.Should().HaveCount(2);
        perek.Pasukim[0].PasukNum.Should().Be(1);
        perek.Pasukim[1].PasukNum.Should().Be(2);
    }

    [Fact]
    public void Perek_ShouldImplementINotifyPropertyChanged()
    {
        var perek = new Perek
        {
            Date = "2026-01-20",
            HebDate = "טבת",
            SeferName = "בראשית",
            SeferTanahUsName = "Genesis",
            Tseit = "17:30"
        };

        perek.Should().BeAssignableTo<INotifyPropertyChanged>();
    }

    [Fact]
    public void Perek_SettingPasukim_ShouldRaisePropertyChanged()
    {
        var perek = new Perek
        {
            Date = "2026-01-20",
            HebDate = "טבת",
            SeferName = "בראשית",
            SeferTanahUsName = "Genesis",
            Tseit = "17:30"
        };

        var raised = false;
        string? changedProperty = null;
        perek.PropertyChanged += (_, args) =>
        {
            raised = true;
            changedProperty = args.PropertyName;
        };

        perek.Pasukim = new List<Pasuk>
        {
            new() { PasukNum = 1, Text = "בראשית ברא" }
        };

        raised.Should().BeTrue();
        changedProperty.Should().Be(nameof(Perek.Pasukim));
    }

    [Fact]
    public void Perek_SettingPasukim_ToEmptyList_ShouldStillRaisePropertyChanged()
    {
        var perek = new Perek
        {
            Date = "2026-01-20",
            HebDate = "טבת",
            SeferName = "בראשית",
            SeferTanahUsName = "Genesis",
            Tseit = "17:30",
            Pasukim = new List<Pasuk> { new() { PasukNum = 1, Text = "test" } }
        };

        var raised = false;
        perek.PropertyChanged += (_, _) => raised = true;

        perek.Pasukim = new List<Pasuk>();

        raised.Should().BeTrue();
        perek.Pasukim.Should().BeEmpty();
    }
}
