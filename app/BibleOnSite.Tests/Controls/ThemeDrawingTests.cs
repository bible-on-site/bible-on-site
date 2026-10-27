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
    [InlineData(AppTheme.Dark, "#2D2D2D")]
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

    [Fact]
    public void TikkunFlowView_ThemeChangedHandler_InvalidatesContent()
    {
        var previous = Application.Current;
        try
        {
            Application.Current = new Application { UserAppTheme = AppTheme.Light };
            var view = new TikkunFlowView();
            var dispatcher = new Mock<IDispatcher>();
            dispatcher.Setup(d => d.Dispatch(It.IsAny<Action>()))
                .Returns((Action action) => { action(); return true; });
            var services = new Mock<IServiceProvider>();
            services.Setup(s => s.GetService(typeof(IDispatcher))).Returns(dispatcher.Object);
            var context = new Mock<IMauiContext>();
            context.SetupGet(c => c.Services).Returns(services.Object);
            var handler = new Mock<IViewHandler>();
            handler.SetupGet(h => h.MauiContext).Returns(context.Object);
            view.Handler = handler.Object;

            view.OnAppRequestedThemeChanged(null, new AppThemeChangedEventArgs(AppTheme.Dark));

            handler.Verify(h => h.Invoke("Invalidate", null), Times.Once);
        }
        finally
        {
            Application.Current = previous;
        }
    }
}
