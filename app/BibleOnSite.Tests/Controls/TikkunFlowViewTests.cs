using BibleOnSite.Controls;
using BibleOnSite.Models;
using FluentAssertions;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Dispatching;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Tests.Controls;

[Collection("Application state")]
public class TikkunFlowViewTests
{
    private static Pasuk PasukOf(int num, string text) => new()
    {
        PasukNum = num,
        Text = text,
        Segments = [new PasukSegment { Type = SegmentType.Ktiv, Value = text }]
    };

    private static Mock<ICanvas> MeasuringCanvas()
    {
        var canvas = new Mock<ICanvas>();
        canvas.Setup(c => c.GetStringSize(It.IsAny<string>(), It.IsAny<IFont>(), It.IsAny<float>()))
            .Returns((string text, IFont _, float size) => new SizeF(text.Length * size * 0.5f, size));
        return canvas;
    }

    private static void WithInlineDispatcher(Action body)
    {
        var dispatcher = new Mock<IDispatcher>();
        dispatcher.Setup(d => d.Dispatch(It.IsAny<Action>()))
            .Returns((Action action) => { action(); return true; });
        var provider = new Mock<IDispatcherProvider>();
        provider.Setup(p => p.GetForCurrentThread()).Returns(dispatcher.Object);
        DispatcherProvider.SetCurrent(provider.Object);
        try
        {
            body();
        }
        finally
        {
            DispatcherProvider.SetCurrent(null);
        }
    }

    private static System.Linq.Expressions.Expression<Action<ICanvas>> DrawStringCall() =>
        c => c.DrawString(It.IsAny<string>(), It.IsAny<float>(), It.IsAny<float>(),
            It.IsAny<float>(), It.IsAny<float>(), It.IsAny<HorizontalAlignment>(),
            It.IsAny<VerticalAlignment>(), It.IsAny<TextFlow>());

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

    [Fact]
    public void draw_lays_out_and_paints_each_word()
    {
        WithInlineDispatcher(() =>
        {
            var view = new TikkunFlowView { Pasukim = [PasukOf(1, "אברהם יצחק")] };
            var canvas = MeasuringCanvas();

            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));

            canvas.Verify(DrawStringCall(), Times.AtLeastOnce);
            view.HeightRequest.Should().BeGreaterThan(0);
        });
    }

    [Fact]
    public void draw_without_pesukim_collapses_height_and_paints_nothing()
    {
        WithInlineDispatcher(() =>
        {
            var view = new TikkunFlowView();
            var canvas = MeasuringCanvas();

            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));
            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));

            canvas.Verify(DrawStringCall(), Times.Never);
            view.HeightRequest.Should().BeLessThan(9);
        });
    }

    [Fact]
    public void draw_narrower_than_the_padding_collapses_height()
    {
        WithInlineDispatcher(() =>
        {
            var view = new TikkunFlowView { Pasukim = [PasukOf(1, "אברהם")] };
            var canvas = MeasuringCanvas();

            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 10, 600));

            canvas.Verify(DrawStringCall(), Times.Never);
            view.HeightRequest.Should().BeLessThan(9);
        });
    }

    [Fact]
    public void repeated_draws_at_the_same_width_keep_painting()
    {
        WithInlineDispatcher(() =>
        {
            var view = new TikkunFlowView { Pasukim = [PasukOf(1, "א")] };
            var canvas = MeasuringCanvas();

            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));
            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));

            canvas.Verify(DrawStringCall(), Times.AtLeast(2));
        });
    }

    [Fact]
    public void draw_in_dark_theme_paints_with_the_dark_default_color()
    {
        var previous = Application.Current;
        try
        {
            Application.Current = new Application { UserAppTheme = AppTheme.Dark };
            WithInlineDispatcher(() =>
            {
                var view = new TikkunFlowView { Pasukim = [PasukOf(1, "א")] };
                var canvas = MeasuringCanvas();

                view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));

                canvas.VerifySet(c => c.FontColor =
                    It.Is<Color>(color => color.Equals(Color.FromArgb("#e0e0e0"))));
            });
        }
        finally
        {
            Application.Current = previous;
        }
    }
}
