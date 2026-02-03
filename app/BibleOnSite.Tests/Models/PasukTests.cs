using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Models;

public class PasukTests
{
    #region PasukNumHeb Tests

    [Theory]
    [InlineData(1, "א")]
    [InlineData(2, "ב")]
    [InlineData(10, "י")]
    [InlineData(15, "טו")]
    [InlineData(16, "טז")]
    [InlineData(22, "כב")]
    [InlineData(150, "קנ")]
    public void PasukNumHeb_ShouldConvertToHebrewLetters(int pasukNum, string expected)
    {
        var pasuk = new Pasuk { PasukNum = pasukNum, Text = "Test" };

        pasuk.PasukNumHeb.Should().Be(expected);
    }

    #endregion

    #region IsSelected Tests

    [Fact]
    public void IsSelected_ShouldBeFalseByDefault()
    {
        var pasuk = new Pasuk { PasukNum = 1, Text = "Test" };

        pasuk.IsSelected.Should().BeFalse();
    }

    [Fact]
    public void IsSelected_ShouldBeSettable()
    {
        var pasuk = new Pasuk { PasukNum = 1, Text = "Test" };

        pasuk.IsSelected = true;

        pasuk.IsSelected.Should().BeTrue();
    }

    #endregion

    #region Segments Tests

    [Fact]
    public void Segments_ShouldBeEmptyByDefault()
    {
        var pasuk = new Pasuk { PasukNum = 1, Text = "Test" };

        pasuk.Segments.Should().BeEmpty();
    }

    [Fact]
    public void Segments_ShouldBeSettable()
    {
        var pasuk = new Pasuk { PasukNum = 1, Text = "Test" };
        var segments = new List<PasukSegment>
        {
            new() { Type = SegmentType.Qri, Value = "בְּרֵאשִׁית" }
        };

        pasuk.Segments = segments;

        pasuk.Segments.Should().HaveCount(1);
    }

    #endregion
}

public class PasukSegmentTests
{
    #region IsQriDifferentThanKtiv Tests

    [Fact]
    public void IsQriDifferentThanKtiv_WhenQriWithPairedOffset_ShouldBeTrue()
    {
        var segment = new PasukSegment
        {
            Type = SegmentType.Qri,
            Value = "הוּא",
            PairedOffset = 1
        };

        segment.IsQriDifferentThanKtiv.Should().BeTrue();
    }

    [Fact]
    public void IsQriDifferentThanKtiv_WhenQriWithoutPairedOffset_ShouldBeFalse()
    {
        var segment = new PasukSegment
        {
            Type = SegmentType.Qri,
            Value = "בְּרֵאשִׁית",
            PairedOffset = null
        };

        segment.IsQriDifferentThanKtiv.Should().BeFalse();
    }

    [Fact]
    public void IsQriDifferentThanKtiv_WhenKtiv_ShouldBeFalse()
    {
        var segment = new PasukSegment
        {
            Type = SegmentType.Ktiv,
            Value = "היא",
            PairedOffset = 1
        };

        segment.IsQriDifferentThanKtiv.Should().BeFalse();
    }

    [Fact]
    public void IsQriDifferentThanKtiv_WhenPtuha_ShouldBeFalse()
    {
        var segment = new PasukSegment
        {
            Type = SegmentType.Ptuha,
            PairedOffset = 1
        };

        segment.IsQriDifferentThanKtiv.Should().BeFalse();
    }

    #endregion

    #region IsKtivDifferentThanQri Tests

    [Fact]
    public void IsKtivDifferentThanQri_WhenKtivWithNonZeroPairedOffset_ShouldBeTrue()
    {
        var segment = new PasukSegment
        {
            Type = SegmentType.Ktiv,
            Value = "היא",
            PairedOffset = 1
        };

        segment.IsKtivDifferentThanQri.Should().BeTrue();
    }

    [Fact]
    public void IsKtivDifferentThanQri_WhenKtivWithZeroPairedOffset_ShouldBeFalse()
    {
        var segment = new PasukSegment
        {
            Type = SegmentType.Ktiv,
            Value = "היא",
            PairedOffset = 0
        };

        segment.IsKtivDifferentThanQri.Should().BeFalse();
    }

    [Fact]
    public void IsKtivDifferentThanQri_WhenKtivWithoutPairedOffset_ShouldBeFalse()
    {
        var segment = new PasukSegment
        {
            Type = SegmentType.Ktiv,
            Value = "בראשית",
            PairedOffset = null
        };

        segment.IsKtivDifferentThanQri.Should().BeFalse();
    }

    [Fact]
    public void IsKtivDifferentThanQri_WhenQri_ShouldBeFalse()
    {
        var segment = new PasukSegment
        {
            Type = SegmentType.Qri,
            Value = "הוּא",
            PairedOffset = 1
        };

        segment.IsKtivDifferentThanQri.Should().BeFalse();
    }

    #endregion

    #region EndsWithMaqaf Tests

    [Fact]
    public void EndsWithMaqaf_WhenEndsWithMaqaf_ShouldBeTrue()
    {
        var segment = new PasukSegment
        {
            Type = SegmentType.Qri,
            Value = "כָּל־"
        };

        segment.EndsWithMaqaf.Should().BeTrue();
    }

    [Fact]
    public void EndsWithMaqaf_WhenDoesNotEndWithMaqaf_ShouldBeFalse()
    {
        var segment = new PasukSegment
        {
            Type = SegmentType.Qri,
            Value = "בְּרֵאשִׁית"
        };

        segment.EndsWithMaqaf.Should().BeFalse();
    }

    [Fact]
    public void EndsWithMaqaf_WhenEmptyValue_ShouldBeFalse()
    {
        var segment = new PasukSegment
        {
            Type = SegmentType.Ptuha,
            Value = ""
        };

        segment.EndsWithMaqaf.Should().BeFalse();
    }

    [Fact]
    public void EndsWithMaqaf_WhenMaqafInMiddle_ShouldBeFalse()
    {
        var segment = new PasukSegment
        {
            Type = SegmentType.Qri,
            Value = "כָּל־הָאָרֶץ"
        };

        segment.EndsWithMaqaf.Should().BeFalse();
    }

    #endregion

    #region SegmentType Tests

    [Fact]
    public void SegmentType_Ktiv_ShouldBeZero()
    {
        ((int)SegmentType.Ktiv).Should().Be(0);
    }

    [Fact]
    public void SegmentType_Qri_ShouldBeOne()
    {
        ((int)SegmentType.Qri).Should().Be(1);
    }

    [Fact]
    public void SegmentType_Ptuha_ShouldBeTwo()
    {
        ((int)SegmentType.Ptuha).Should().Be(2);
    }

    [Fact]
    public void SegmentType_Stuma_ShouldBeThree()
    {
        ((int)SegmentType.Stuma).Should().Be(3);
    }

    #endregion
}

public class PasukComponentTests
{
    [Fact]
    public void PasukComponentType_Text_ShouldBeZero()
    {
        ((int)PasukComponentType.Text).Should().Be(0);
    }

    [Fact]
    public void PasukComponentType_Samech_ShouldBeOne()
    {
        ((int)PasukComponentType.Samech).Should().Be(1);
    }

    [Fact]
    public void PasukComponentType_Peh_ShouldBeTwo()
    {
        ((int)PasukComponentType.Peh).Should().Be(2);
    }

    [Fact]
    public void PasukComponentType_NunHafucha_ShouldBeThree()
    {
        ((int)PasukComponentType.NunHafucha).Should().Be(3);
    }

    [Fact]
    public void PasukComponent_ContentShouldBeEmptyByDefault()
    {
        var component = new PasukComponent();

        component.Content.Should().BeEmpty();
    }

    [Fact]
    public void PasukComponent_ShouldBeSettable()
    {
        var component = new PasukComponent
        {
            Type = PasukComponentType.Text,
            Content = "בראשית"
        };

        component.Type.Should().Be(PasukComponentType.Text);
        component.Content.Should().Be("בראשית");
    }
}
