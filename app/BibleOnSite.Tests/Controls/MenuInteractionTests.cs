using BibleOnSite.Controls;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Tests.Controls;

public class MenuInteractionTests
{
    [Fact]
    public void Drawable_FillsClosedNotchedPath_AndAppliesShadow()
    {
        var canvas = new Mock<ICanvas>();
        PathF? path = null;
        canvas.Setup(c => c.FillPath(It.IsAny<PathF>(), It.IsAny<WindingMode>())).Callback<PathF, WindingMode>((p, _) => path = p);
        var bounds = new RectF(0, 0, 400, 80);
        new BottomBarDrawable().Draw(canvas.Object, bounds);
        canvas.VerifySet(c => c.FillColor = Colors.Transparent, Times.Once);
        canvas.Verify(c => c.FillRectangle(0, 0, 400, 80), Times.Once);
        canvas.Verify(c => c.SetShadow(new SizeF(0, -2), 6, It.IsAny<Color>()), Times.Once);
        canvas.Verify(c => c.SetFillPaint(It.IsAny<SolidPaint>(), bounds), Times.Once);
        path.Should().NotBeNull();
        path!.Points.Should().Contain(new PointF(0, 80)).And.Contain(new PointF(400, 80));
    }
}
