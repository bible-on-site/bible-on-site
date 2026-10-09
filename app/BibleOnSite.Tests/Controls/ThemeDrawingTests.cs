using BibleOnSite.Controls;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Tests.Controls;

[CollectionDefinition("Application state", DisableParallelization = true)]
public class ApplicationStateCollection;

[Collection("Application state")]
public class ThemeDrawingTests
{
    [Theory]
    [InlineData(AppTheme.Light, "#FFFFFF")]
    [InlineData(AppTheme.Dark, "#1C1C1E")]
    public void BottomBar_UsesRequestedThemeForReadableBackground(AppTheme theme, string expected)
    {
        var previous = Application.Current;
        try
        {
            Application.Current = new Application { UserAppTheme = theme };
            var canvas = new Mock<ICanvas>();
            new BottomBarDrawable().Draw(canvas.Object, new RectF(0, 0, 400, 80));
            canvas.Verify(c => c.SetFillPaint(It.Is<SolidPaint>(p => p.Color.Equals(Color.FromArgb(expected))),
                It.IsAny<RectF>()), Times.Once);
        }
        finally
        {
            Application.Current = previous;
        }
    }
}
