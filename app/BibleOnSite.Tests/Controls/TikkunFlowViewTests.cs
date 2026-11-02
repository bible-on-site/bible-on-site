using BibleOnSite.Controls;
using BibleOnSite.Helpers;
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

    private static Mock<ICanvas> MeasuringCanvas(double widthFactor = 0.5)
    {
        var canvas = new Mock<ICanvas>();
        canvas.Setup(c => c.GetStringSize(It.IsAny<string>(), It.IsAny<IFont>(), It.IsAny<float>()))
            .Returns((string text, IFont _, float size) => new SizeF((float)(text.Length * size * widthFactor), size));
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
        view.MaskingRevision = 7;
        view.TextFontSize = 24;

        view.Pasukim.Should().BeSameAs(pesukim);
        view.RepeatEachPasuk.Should().BeTrue();
        view.HideMarks.Should().BeTrue();
        view.MaskingRevision.Should().Be(7);
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
    public void draw_gives_each_word_a_box_it_cannot_wrap_inside()
    {
        WithInlineDispatcher(() =>
        {
            var view = new TikkunFlowView { Pasukim = [PasukOf(1, "אאאא בב")] };
            var canvas = MeasuringCanvas();

            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));

            // Android turns the DrawString width into an int and hands it to a
            // StaticLayout as the wrap constraint: a box snugger than the word's
            // drawn width fragments it into narrow vertical pieces (#2069).
            // Every word must therefore get at least the whole text column as
            // its box — text direction is forced LTR inside DrawString, so a
            // wide box stays left-anchored at the computed x and cannot
            // re-align. Text column here is 360 − 12 − 12 = 336.
            canvas.Verify(c => c.DrawString("אאאא", It.IsAny<float>(), It.IsAny<float>(),
                It.Is<float>(w => w >= 336), It.IsAny<float>(), It.IsAny<HorizontalAlignment>(),
                It.IsAny<VerticalAlignment>(), It.IsAny<TextFlow>()));
            canvas.Verify(c => c.DrawString("בב", It.IsAny<float>(), It.IsAny<float>(),
                It.Is<float>(w => w >= 336), It.IsAny<float>(), It.IsAny<HorizontalAlignment>(),
                It.IsAny<VerticalAlignment>(), It.IsAny<TextFlow>()));
        });
    }

    [Fact]
    public void draw_box_covers_an_overlong_word_that_exceeds_the_column()
    {
        WithInlineDispatcher(() =>
        {
            // A word wider than the whole column must still not wrap: its box is
            // its own measured width plus slack. 30 letters × 18 × 1.5 = 810
            // measured, wider than the 336-wide column.
            var view = new TikkunFlowView { Pasukim = [PasukOf(1, "אאאאאאאאאאאאאאאאאאאאאאאאאאאאאא")] };
            var canvas = MeasuringCanvas(widthFactor: 1.5);

            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));

            canvas.Verify(c => c.DrawString(It.IsAny<string>(), It.IsAny<float>(), It.IsAny<float>(),
                It.Is<float>(w => w > 810), It.IsAny<float>(), It.IsAny<HorizontalAlignment>(),
                It.IsAny<VerticalAlignment>(), It.IsAny<TextFlow>()));
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
    public void relayout_after_invalidation_measures_each_unique_word_once()
    {
        WithInlineDispatcher(() =>
        {
            var view = new TikkunFlowView { Pasukim = [PasukOf(1, "אא בב אא")] };
            var canvas = MeasuringCanvas();

            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));
            view.MaskingRevision = 1;
            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));

            canvas.Verify(c => c.GetStringSize("אא", It.IsAny<IFont>(), It.IsAny<float>()), Times.Once);
            canvas.Verify(c => c.GetStringSize("בב", It.IsAny<IFont>(), It.IsAny<float>()), Times.Once);
        });
    }

    [Fact]
    public void relayout_on_a_canvas_with_different_metrics_remeasures()
    {
        WithInlineDispatcher(() =>
        {
            var view = new TikkunFlowView { Pasukim = [PasukOf(1, "אא")] };
            var narrow = MeasuringCanvas();
            var wide = MeasuringCanvas(widthFactor: 0.9);

            view.Drawable!.Draw(narrow.Object, new RectF(0, 0, 360, 600));
            view.MaskingRevision = 1;
            view.Drawable!.Draw(wide.Object, new RectF(0, 0, 360, 600));

            wide.Verify(c => c.GetStringSize("אא", It.IsAny<IFont>(), It.IsAny<float>()), Times.Once);
        });
    }

    [Fact]
    public void font_size_change_remeasures_instead_of_reusing_stale_widths()
    {
        WithInlineDispatcher(() =>
        {
            var view = new TikkunFlowView { Pasukim = [PasukOf(1, "אא")] };
            var canvas = MeasuringCanvas();

            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));
            view.TextFontSize = 30;
            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));

            canvas.Verify(c => c.GetStringSize("אא", It.IsAny<IFont>(), 30f), Times.Once);
            canvas.Verify(c => c.GetStringSize("אא", It.IsAny<IFont>(), 18f), Times.Once);
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

    // #2623: תיקון קוראים is a scripture presentation — its canvas draws and
    // measures in the same Taamey D face as the pasuk labels (a different
    // measure face would also corrupt the justification math). The canvas
    // resolves IFont.Name itself, so the contract fields are the oracle —
    // the platform spell differs per OS (asset name / PostScript / URI).
    [Fact]
    public void draw_paints_and_measures_words_in_the_scripture_font()
    {
        WithInlineDispatcher(() =>
        {
            var view = new TikkunFlowView { Pasukim = [PasukOf(1, "אברהם יצחק")] };
            var canvas = MeasuringCanvas();

            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));

            canvas.VerifySet(c => c.Font =
                It.Is<IFont>(f => f.Name == ScriptureFonts.Regular.Name), Times.AtLeastOnce);
            // The pasuk-number word is bold — its face is the bold scripture variant.
            canvas.VerifySet(c => c.Font =
                It.Is<IFont>(f => f.Name == ScriptureFonts.Bold.Name &&
                                  f.Weight == FontWeights.Bold), Times.AtLeastOnce);
            canvas.Verify(c => c.GetStringSize(It.IsAny<string>(),
                It.Is<IFont>(f => f.Name == ScriptureFonts.Regular.Name),
                It.IsAny<float>()), Times.AtLeastOnce);
        });
    }

    // #2623: bundled fonts resolve to a real typeface on Android/iOS, so the
    // canvas there drops IFont.Weight — marker words are double-struck to keep
    // the emphasis the system font used to give (#if !WINDOWS keeps this
    // branch active in the net10.0 test target).
    [Fact]
    public void draw_double_strikes_bold_marker_words_for_faux_bold()
    {
        WithInlineDispatcher(() =>
        {
            var view = new TikkunFlowView { Pasukim = [PasukOf(1, "אברהם")] };
            var canvas = MeasuringCanvas();

            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));

            // The "א" pasuk-number marker is bold → struck twice; the verse
            // word itself is regular → struck once.
            canvas.Verify(c => c.DrawString("א", It.IsAny<float>(), It.IsAny<float>(),
                It.IsAny<float>(), It.IsAny<float>(), It.IsAny<HorizontalAlignment>(),
                It.IsAny<VerticalAlignment>(), It.IsAny<TextFlow>()), Times.Exactly(2));
            canvas.Verify(c => c.DrawString("אברהם", It.IsAny<float>(), It.IsAny<float>(),
                It.IsAny<float>(), It.IsAny<float>(), It.IsAny<HorizontalAlignment>(),
                It.IsAny<VerticalAlignment>(), It.IsAny<TextFlow>()), Times.Once);
        });
    }

    // #2839: the letter budget lives in the shared layout, so the canvas draw
    // honors it too — here width would fit ~93 words, so only the 34-letter
    // budget can end the first rendered line.
    [Fact]
    public void draw_caps_each_rendered_line_at_the_hebrew_letter_budget()
    {
        WithInlineDispatcher(() =>
        {
            // Distinct two-letter words so per-line text dedup only removes
            // the bold marker's faux-bold strike, never a real word.
            var text = string.Join(' ', Enumerable.Range(0, 40)
                .Select(i => new string([(char)('א' + i % 22), (char)('א' + i / 22)])));
            var view = new TikkunFlowView { Pasukim = [PasukOf(1, text)] };
            var canvas = MeasuringCanvas(widthFactor: 0.1);
            var draws = new List<(string Text, float Y)>();
            canvas.Setup(c => c.DrawString(It.IsAny<string>(), It.IsAny<float>(), It.IsAny<float>(),
                    It.IsAny<float>(), It.IsAny<float>(), It.IsAny<HorizontalAlignment>(),
                    It.IsAny<VerticalAlignment>(), It.IsAny<TextFlow>(), It.IsAny<float>()))
                .Callback((string t, float _, float y, float _, float _,
                           HorizontalAlignment _, VerticalAlignment _, TextFlow _, float _) =>
                    draws.Add((t, y)));

            view.Drawable!.Draw(canvas.Object, new RectF(0, 0, 360, 600));

            // Marker "א" + 16 words = 33 letters, then 17 (34), then the last 7
            // copies (14). Bold marker words strike twice — count distinct text.
            var lines = draws.GroupBy(d => d.Y).OrderBy(g => g.Key).ToList();
            lines.Should().HaveCount(3);
            lines.Select(line => line.Select(d => d.Text).Distinct()
                    .Sum(TikkunFlowLayout.HebrewLetters))
                .Should().Equal(33, 34, 14);
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
