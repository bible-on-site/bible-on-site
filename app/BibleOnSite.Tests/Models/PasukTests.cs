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
