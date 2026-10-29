using BibleOnSite.Controls;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Controls;

public class TriStateCheckBoxTests
{
    [Theory]
    [InlineData(0, 6, TriCheckState.Unchecked)]
    [InlineData(3, 6, TriCheckState.Indeterminate)]
    [InlineData(6, 6, TriCheckState.Checked)]
    [InlineData(0, 0, TriCheckState.Unchecked)]
    [InlineData(7, 6, TriCheckState.Checked)]
    public void DeriveState_MapsSelectionCounts(int selected, int total, TriCheckState expected) =>
        TriStateCheckBox.DeriveState(selected, total).Should().Be(expected);

    [Fact]
    public void Toggle_PartialBecomesChecked_ThenUnchecked()
    {
        var box = new TriStateCheckBox { State = TriCheckState.Indeterminate };

        box.Toggle();
        box.State.Should().Be(TriCheckState.Checked, "a partial set selects everything on tap");

        box.Toggle();
        box.State.Should().Be(TriCheckState.Unchecked, "a full set clears on tap");
    }

    [Fact]
    public void Toggle_RaisesToggledWithNewState()
    {
        var box = new TriStateCheckBox();
        var raised = 0;
        box.Toggled = () => raised++;

        box.Toggle();

        raised.Should().Be(1);
        box.State.Should().Be(TriCheckState.Checked);
    }

    [Fact]
    public void Toggle_DisabledBox_DoesNothing()
    {
        var box = new TriStateCheckBox { IsEnabled = false };

        box.Toggle();

        box.State.Should().Be(TriCheckState.Unchecked);
    }

    // --- #2724 artwork contract: the tick must keep a normal orientation and
    // centered geometry inside the square regardless of the ambient RTL row. ---

    [Fact]
    public void Artwork_InsideTheSquare_IsDirectionIsolated()
    {
        var box = new TriStateCheckBox();

        var canvas = box._box.Content.Should().BeOfType<Grid>().Subject;
        canvas.FlowDirection.Should().Be(FlowDirection.LeftToRight,
            "PlatformGraphicsView mirrors its canvas under RTL — the tick artwork must stay LTR");
    }

    [Fact]
    public void Artwork_TickPoints_CenterInsideTheSquare()
    {
        var box = new TriStateCheckBox();
        var points = box._check.Points;

        var minX = points.Min(p => p.X);
        var maxX = points.Max(p => p.X);
        var minY = points.Min(p => p.Y);
        var maxY = points.Max(p => p.Y);

        ((minX + maxX) / 2).Should().Be(10, "the tick centers horizontally in the 20×20 square");
        ((minY + maxY) / 2).Should().Be(10, "the tick centers vertically in the 20×20 square");
        maxX.Should().BeLessThanOrEqualTo(18, "the tick (with stroke) must stay inside the square");
        minX.Should().BeGreaterThanOrEqualTo(2, "the tick (with stroke) must stay inside the square");
        maxY.Should().BeLessThanOrEqualTo(18, "the tick (with stroke) must stay inside the square");
        minY.Should().BeGreaterThanOrEqualTo(2, "the tick (with stroke) must stay inside the square");
    }

    [Fact]
    public void Artwork_IndeterminateDash_IsCenteredNotStretched()
    {
        var box = new TriStateCheckBox();

        box._dash.HorizontalOptions.Should().Be(LayoutOptions.Center,
            "Fill would stretch the dash across the whole square");
        box._dash.VerticalOptions.Should().Be(LayoutOptions.Center,
            "Fill would stretch the dash across the whole square");
        box._dash.WidthRequest.Should().Be(10);
        box._dash.HeightRequest.Should().Be(2);
    }

    [Fact]
    public void Square_CentersInsideTheControl_LikeTheNativeRows()
    {
        var box = new TriStateCheckBox();

        box._box.HorizontalOptions.Should().Be(LayoutOptions.Center,
            "the native row checkbox centers its square inside the 44-wide control");
        box._box.VerticalOptions.Should().Be(LayoutOptions.Center);
        box.WidthRequest.Should().Be(TriStateCheckBox.RowWidth,
            "match the native checkbox's effective column width so squares line up");
        box.HeightRequest.Should().Be(TriStateCheckBox.RowHeight);
    }
}
