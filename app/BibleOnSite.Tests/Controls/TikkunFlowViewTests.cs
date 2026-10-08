using BibleOnSite.Controls;
using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Controls;

public class TikkunFlowViewTests
{
    private static Pasuk PasukOf(int num, string text) => new()
    {
        PasukNum = num,
        Text = text,
        Segments = [new PasukSegment { Type = SegmentType.Ktiv, Value = text }]
    };

    [Fact]
    public void constructor_forces_ltr_canvas_and_a_positive_height_estimate()
    {
        var view = new TikkunFlowView();

        view.FlowDirection.Should().Be(FlowDirection.LeftToRight);
        view.Drawable.Should().NotBeNull();
        view.HeightRequest.Should().BeGreaterThan(0);
    }

    [Fact]
    public void bindable_properties_round_trip()
    {
        var view = new TikkunFlowView();
        var pesukim = new List<Pasuk> { PasukOf(1, "א") };

        view.Pasukim = pesukim;
        view.RepeatEachPasuk = true;
        view.HideMarks = true;
        view.TextFontSize = 24;

        view.Pasukim.Should().BeSameAs(pesukim);
        view.RepeatEachPasuk.Should().BeTrue();
        view.HideMarks.Should().BeTrue();
        view.TextFontSize.Should().Be(24);
    }

    [Fact]
    public void setting_the_same_pasukim_twice_does_not_throw()
    {
        var view = new TikkunFlowView();
        var pesukim = new List<Pasuk> { PasukOf(1, "א") };

        view.Pasukim = pesukim;
        var act = () => view.Pasukim = pesukim;

        act.Should().NotThrow();
    }

    [Fact]
    public void clearing_pasukim_back_to_null_is_safe()
    {
        var view = new TikkunFlowView { Pasukim = [PasukOf(1, "א")] };

        var act = () => view.Pasukim = null;

        act.Should().NotThrow();
        view.Pasukim.Should().BeNull();
    }
}
