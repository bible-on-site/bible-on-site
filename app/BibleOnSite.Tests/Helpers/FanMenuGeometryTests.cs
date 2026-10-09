using BibleOnSite.Helpers;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Tests.Helpers;

public class FanMenuGeometryTests
{
    private const double ItemSize = FanMenuGeometry.ItemSize;
    private const double ToggleSize = FanMenuGeometry.ToggleSize;

    /// <summary>
    /// Representative canvases (FloatingMenuContainer arrange area, dp):
    /// small/narrow phone, typical phone, large phone, tablet — portrait and
    /// landscape — plus a short landscape and degenerate split-screen sizes.
    /// </summary>
    public static IEnumerable<object[]> Canvases =>
    [
        [320.0, 568.0],   // small/narrow phone portrait (iPhone SE class)
        [360.0, 744.0],   // typical phone portrait (1080x2400 @3x minus toolbar)
        [393.0, 796.0],   // large phone portrait
        [430.0, 840.0],   // extra-large phone portrait
        [600.0, 960.0],   // small tablet portrait
        [744.0, 360.0],   // typical phone landscape (limited height)
        [852.0, 393.0],   // large phone landscape
        [960.0, 600.0],   // tablet landscape
        [640.0, 250.0],   // very short landscape window
        [280.0, 500.0],   // narrow split-screen window
        [240.0, 320.0],   // degenerate narrow window
    ];

    [Theory]
    [MemberData(nameof(Canvases))]
    public void Toggle_IsCenteredHorizontally_AndAnchoredAboveBottom(double width, double height)
    {
        var layout = FanMenuGeometry.Compute(width, height);

        layout.Toggle.Width.Should().Be(ToggleSize);
        layout.Toggle.Height.Should().Be(ToggleSize);
        layout.Toggle.Center.X.Should().BeApproximately(width / 2, 0.01);
        layout.Toggle.Bottom.Should().BeApproximately(
            height - FanMenuGeometry.ToggleBottomClearance, 0.01,
            "the toggle sits in the bottom-bar notch at a fixed distance from the bottom edge");
    }

    [Theory]
    [MemberData(nameof(Canvases))]
    public void Items_StayInsideCanvas(double width, double height)
    {
        var layout = FanMenuGeometry.Compute(width, height);

        layout.Items.Should().HaveCount(4);
        foreach (var item in layout.Items)
        {
            item.Left.Should().BeGreaterThanOrEqualTo(0);
            item.Top.Should().BeGreaterThanOrEqualTo(0);
            item.Right.Should().BeLessThanOrEqualTo(width);
            item.Bottom.Should().BeLessThanOrEqualTo(height);
        }
    }

    [Theory]
    [MemberData(nameof(Canvases))]
    public void Items_DoNotOverlapEachOther(double width, double height)
    {
        var layout = FanMenuGeometry.Compute(width, height);

        for (var i = 0; i < layout.Items.Count; i++)
        {
            for (var j = i + 1; j < layout.Items.Count; j++)
            {
                layout.Items[i].IntersectsWith(layout.Items[j]).Should().BeFalse(
                    $"action {i} must not overlap action {j} on a {width}x{height} canvas");
            }
        }
    }

    [Theory]
    [MemberData(nameof(Canvases))]
    public void Items_DoNotOverlapToggle(double width, double height)
    {
        var layout = FanMenuGeometry.Compute(width, height);

        foreach (var item in layout.Items)
        {
            item.IntersectsWith(layout.Toggle).Should().BeFalse(
                "actions must never cover the open/close button");
        }
    }

    [Theory]
    [MemberData(nameof(Canvases))]
    public void Items_DoNotOverlapBottomBarButtons(double width, double height)
    {
        var layout = FanMenuGeometry.Compute(width, height);

        foreach (var item in layout.Items)
        {
            foreach (var obstacle in layout.Obstacles)
            {
                item.IntersectsWith(obstacle).Should().BeFalse(
                    "actions must never cover the bottom-bar buttons' interactive area");
            }
        }
    }

    [Theory]
    [MemberData(nameof(Canvases))]
    public void Items_AreSymmetricAboutTheCenterAxis(double width, double height)
    {
        var layout = FanMenuGeometry.Compute(width, height);
        var cx = width / 2;

        for (var i = 0; i < layout.Items.Count / 2; i++)
        {
            var left = layout.Items[i];
            var right = layout.Items[layout.Items.Count - 1 - i];
            (left.Center.X - cx).Should().BeApproximately(cx - right.Center.X, 0.01,
                "the fan is symmetric about the toggle");
            left.Center.Y.Should().BeApproximately(right.Center.Y, 0.01);
        }
    }

    [Theory]
    [InlineData(744, 360)]   // typical phone landscape
    [InlineData(852, 393)]   // large phone landscape
    [InlineData(960, 600)]   // tablet landscape
    [InlineData(2000, 700)]  // very wide window
    public void Landscape_KeepsCompactCenteredGroup(double width, double height)
    {
        var layout = FanMenuGeometry.Compute(width, height);
        var cx = width / 2;

        var maxOffset = layout.Items.Max(i => Math.Abs(i.Center.X - cx));
        maxOffset.Should().BeLessThanOrEqualTo(
            FanMenuGeometry.PreferredRadiusX + ItemSize / 2 + 1,
            "the fan is bounded: actions never spread proportionally across a wide window");

        // The group hugs the center: outer actions sit ~85dp out, not at window fractions.
        var outerOffset = layout.Items
            .Where((_, i) => i == 0 || i == layout.Items.Count - 1)
            .Max(i => Math.Abs(i.Center.X - cx));
        outerOffset.Should().BeApproximately(
            FanMenuGeometry.PreferredRadiusX * Math.Sin(FanMenuGeometry.MaxAngleDegrees * Math.PI / 180),
            0.5);
    }

    [Fact]
    public void Portrait_LaysOutTheEllipticalArc()
    {
        // 360x744 canvas: rx=98, ry=64 ellipse; dx offsets uniform in ±84.9.
        var layout = FanMenuGeometry.Compute(360, 744);
        var cx = 360 / 2.0;
        var cy = 744 - FanMenuGeometry.ToggleBottomClearance - ToggleSize / 2;

        var inner = layout.Items[1];
        var outer = layout.Items[0];
        (cx - inner.Center.X).Should().BeApproximately(28.3, 0.5);
        (cy - inner.Center.Y).Should().BeApproximately(61.3, 0.5);
        (cx - outer.Center.X).Should().BeApproximately(84.9, 0.5);
        (cy - outer.Center.Y).Should().BeApproximately(32.0, 0.5);
    }

    [Fact]
    public void FanShape_IsIndependentOfCanvasSize_WhenRoomAllows()
    {
        // Same offsets on a phone portrait and a tablet landscape: a rigid,
        // compact group rather than a proportional one.
        var phone = FanMenuGeometry.Compute(360, 744);
        var tablet = FanMenuGeometry.Compute(1024, 700);

        var phoneOffsets = Offsets(phone);
        var tabletOffsets = Offsets(tablet);
        for (var i = 0; i < phoneOffsets.Count; i++)
        {
            tabletOffsets[i].X.Should().BeApproximately(phoneOffsets[i].X, 0.01);
            tabletOffsets[i].Y.Should().BeApproximately(phoneOffsets[i].Y, 0.01);
        }

        static List<Point> Offsets(FanMenuGeometry.Result layout) =>
            layout.Items.Select(i => new Point(
                i.Center.X - layout.Toggle.Center.X,
                i.Center.Y - layout.Toggle.Center.Y)).ToList();
    }

    [Fact]
    public void RecalculatesAcrossRotation()
    {
        var portrait = FanMenuGeometry.Compute(360, 744);
        var landscape = FanMenuGeometry.Compute(744, 360);

        landscape.Toggle.Center.X.Should().BeApproximately(372, 0.01);
        // Both orientations keep every action clear of every fixed bar button.
        AssertAllClear(landscape);
        AssertAllClear(portrait);

        static void AssertAllClear(FanMenuGeometry.Result layout)
        {
            foreach (var item in layout.Items)
            {
                item.IntersectsWith(layout.Toggle).Should().BeFalse();
                foreach (var obstacle in layout.Obstacles)
                {
                    item.IntersectsWith(obstacle).Should().BeFalse();
                }
            }
        }
    }

    [Fact]
    public void Compute_IsDeterministic()
    {
        var first = FanMenuGeometry.Compute(393, 796);
        var second = FanMenuGeometry.Compute(393, 796);

        second.Toggle.Should().Be(first.Toggle);
        second.Items.Should().Equal(first.Items);
    }

    [Fact]
    public void DegenerateCanvas_KeepsActionsInsideBounds()
    {
        var layout = FanMenuGeometry.Compute(140, 150);

        layout.Items.Should().HaveCount(4);
        foreach (var item in layout.Items)
        {
            item.Left.Should().BeGreaterThanOrEqualTo(0);
            item.Top.Should().BeGreaterThanOrEqualTo(0);
            item.Right.Should().BeLessThanOrEqualTo(140);
            item.Bottom.Should().BeLessThanOrEqualTo(150);
        }
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(6)]
    public void OtherItemCounts_StayInsideCanvas(int count)
    {
        var layout = FanMenuGeometry.Compute(360, 744, count);

        layout.Items.Should().HaveCount(count);
        foreach (var item in layout.Items)
        {
            item.Left.Should().BeGreaterThanOrEqualTo(0);
            item.Right.Should().BeLessThanOrEqualTo(360);
            item.Top.Should().BeGreaterThanOrEqualTo(0);
            item.Bottom.Should().BeLessThanOrEqualTo(744);
            item.IntersectsWith(layout.Toggle).Should().BeFalse();
        }
    }
}
