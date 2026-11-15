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
    private static Pasuk PasukOf(string text) => new()
    {
        PasukNum = 1,
        Text = text,
        Segments = [new PasukSegment { Type = SegmentType.Ktiv, Value = text }]
    };

    private sealed record Paint(string Text, PathF Path, bool IsMark, float X, float Y, Color Color);

    /// <summary>Captures actual shaped contours and the canvas transform that
    /// paints them, rather than substituting fake string widths/origins.</summary>
    private sealed class Rig : IDisposable
    {
        public TikkunFlowView View { get; }
        public Mock<ICanvas> Canvas { get; } = new();
        public List<(string Text, float Size)> Shapes { get; } = [];
        public Dictionary<(string, float), TikkunGlyphRun> Runs { get; } = [];
        private readonly List<Paint> _paint = [];

        public Rig(string? text)
        {
            var dispatcher = new Mock<IDispatcher>();
            dispatcher.Setup(d => d.Dispatch(It.IsAny<Action>()))
                .Returns((Action action) => { action(); return true; });
            var provider = new Mock<IDispatcherProvider>();
            provider.Setup(p => p.GetForCurrentThread()).Returns(dispatcher.Object);
            DispatcherProvider.SetCurrent(provider.Object);
            View = new TikkunFlowView((word, size) =>
            {
                Shapes.Add((word, size));
                var run = TikkunFont.Shape(word, size);
                Runs[(word, size)] = run;
                return run;
            });
            if (text is not null)
            {
                View.Pasukim = [PasukOf(text)];
            }
            var x = 0f;
            var y = 0f;
            var color = Colors.Black;
            var saved = new Stack<(float X, float Y)>();
            Canvas.Setup(c => c.SaveState()).Callback(() => saved.Push((x, y)));
            Canvas.Setup(c => c.RestoreState()).Callback(() => (x, y) = saved.Pop()).Returns(true);
            Canvas.Setup(c => c.Translate(It.IsAny<float>(), It.IsAny<float>()))
                .Callback((float dx, float dy) => { x += dx; y += dy; });
            Canvas.SetupSet(c => c.FillColor = It.IsAny<Color>()).Callback((Color value) => color = value);
            Canvas.Setup(c => c.FillPath(It.IsAny<PathF>(), It.IsAny<WindingMode>()))
                .Callback((PathF path, WindingMode _) =>
                {
                    var source = Runs.First(p => ReferenceEquals(p.Value.Bases, path) || ReferenceEquals(p.Value.Marks, path));
                    _paint.Add(new Paint(source.Key.Item1, path, ReferenceEquals(path, source.Value.Marks), x, y, color));
                });
        }

        public Paint[] Draw(float width = 360)
        {
            _paint.Clear();
            View.Drawable!.Draw(Canvas.Object, new RectF(0, 0, width, 600));
            return _paint.ToArray();
        }

        public void Dispose() => DispatcherProvider.SetCurrent(null);
    }

    [Fact]
    public void constructor_and_bindable_properties_preserve_the_reader_contract()
    {
        using var rig = new Rig("א");
        rig.View.FlowDirection.Should().Be(FlowDirection.LeftToRight);
        rig.View.HeightRequest.Should().BeGreaterThan(0);
        rig.View.RepeatEachPasuk = true;
        rig.View.HideMarks = true;
        rig.View.MaskingRevision = 7;
        rig.View.TextFontSize = 24;
        rig.View.RepeatEachPasuk.Should().BeTrue();
        rig.View.HideMarks.Should().BeTrue();
        rig.View.MaskingRevision.Should().Be(7);
        rig.View.TextFontSize.Should().Be(24);
        var same = rig.View.Pasukim;
        rig.View.Pasukim = same;
        rig.View.Pasukim.Should().BeSameAs(same);
        rig.View.Pasukim = null;
        rig.View.Pasukim.Should().BeNull();
    }

    [Theory]
    [InlineData(null, 360)]
    [InlineData("אברהם", 10)]
    public void empty_or_too_narrow_flow_paints_nothing(string? text, float width)
    {
        using var rig = new Rig(text);
        rig.Draw(width).Should().BeEmpty();
        rig.Draw(width).Should().BeEmpty();
        rig.View.HeightRequest.Should().BeLessThan(9);
    }

    [Theory]
    [InlineData("וַיַּ֧רְא")]
    [InlineData("בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים")]
    [InlineData("שָׁ֣ם שָׂ֔ם מֶ֖לֶךְ אֶת־הָאָ֑רֶץ")]
    [InlineData("יְרוּשָׁלַ֗͏ִם׃")]
    [InlineData("(קְרִי: וַיַּ֧רְא)")]
    public void toggling_marks_preserves_every_painted_base_contour_and_origin(string text)
    {
        using var rig = new Rig(text);
        var shown = rig.Draw();
        var bases = shown.Where(p => !p.IsMark).ToArray();
        shown.Should().Contain(p => p.IsMark);
        var shapes = rig.Shapes.Count;
        var height = rig.View.HeightRequest;

        for (var i = 0; i < 3; i++)
        {
            rig.View.HideMarks = true;
            rig.Draw().Should().Equal(bases, "the same glyph contours paint at the same baselines and origins");
            rig.View.HideMarks = false;
            rig.Draw().Should().Equal(shown);
        }
        rig.Shapes.Should().HaveCount(shapes, "visibility never reshapes a stripped word");
        rig.View.HeightRequest.Should().Be(height);
    }

    [Theory]
    [InlineData("֖")]
    [InlineData("׀")]
    public void a_marks_only_segment_keeps_geometry_without_painting_an_empty_base_path(string text)
    {
        using var rig = new Rig(text);
        var shown = rig.Draw();
        var height = rig.View.HeightRequest;
        shown.Should().Contain(p => p.Text == text && p.IsMark);
        rig.View.HideMarks = true;
        rig.Draw().Should().NotContain(p => p.Text == text);
        rig.View.HeightRequest.Should().Be(height);
    }

    [Fact]
    public void repeated_words_and_repaints_reuse_shaped_runs()
    {
        using var rig = new Rig("וַיַּ֧רְא וַיַּ֧רְא");
        var first = rig.Draw();
        rig.Draw().Should().Equal(first);
        rig.View.MaskingRevision++;
        rig.Draw().Should().Equal(first);
        rig.Shapes.Count(s => s.Text == "וַיַּ֧רְא").Should().Be(1);
        rig.Canvas.Verify(c => c.GetStringSize(It.IsAny<string>(), It.IsAny<IFont>(), It.IsAny<float>()), Times.Never);
    }

    [Fact]
    public void font_resize_and_content_changes_establish_new_marked_geometry()
    {
        using var rig = new Rig("וַיַּ֧רְא");
        rig.Draw();
        var originalWidth = rig.Runs[("וַיַּ֧רְא", 18)].Width;
        rig.View.TextFontSize = 36;
        var enlarged = rig.Draw();
        rig.Runs[("וַיַּ֧רְא", 36)].Width.Should().BeApproximately(originalWidth * 2, 0.001f);
        rig.View.HideMarks = true;
        rig.Draw().Should().Equal(enlarged.Where(p => !p.IsMark));
        rig.View.Pasukim = [PasukOf("מֶלֶךְ")];
        rig.Draw().Should().Contain(p => p.Text == "מֶלֶךְ");
        rig.View.Pasukim = [PasukOf("וַיַּ֧רְא")];
        rig.Draw();
        rig.Shapes.Count(s => s.Text == "וַיַּ֧רְא" && Math.Abs(s.Size - 36) < 0.01f)
            .Should().Be(2, "old chapters' cached glyphs are released");
    }

    [Fact]
    public void narrow_and_wide_layouts_each_preserve_base_geometry_across_the_toggle()
    {
        using var rig = new Rig("וַיַּ֧רְא בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים");
        var wide = rig.Draw();
        var narrow = rig.Draw(110);
        rig.View.HideMarks = true;
        rig.Draw(110).Should().Equal(narrow.Where(p => !p.IsMark));
        rig.Draw().Should().Equal(wide.Where(p => !p.IsMark));
    }

    [Fact]
    public void overlong_words_are_painted_as_complete_paths_without_a_native_text_wrap_box()
    {
        var word = new string('א', 80);
        using var rig = new Rig(word);
        rig.Draw().Count(p => p.Text == word).Should().Be(1);
        rig.Runs[(word, 18)].Glyphs.Should().HaveCount(80);
        rig.Runs[(word, 18)].Width.Should().BeGreaterThan(336);
    }

    [Fact]
    public void repeating_a_pasuk_keeps_one_emphasized_marker_and_duplicates_the_verse()
    {
        using var rig = new Rig("בְּרֵאשִׁ֖ית");
        rig.View.RepeatEachPasuk = true;
        var paints = rig.Draw();
        paints.Count(p => p.Text == "א").Should().Be(2, "the one marker is painted twice for emphasis");
        paints.Count(p => p.Text == "בְּרֵאשִׁ֖ית" && !p.IsMark).Should().Be(2);
    }

    [Fact]
    public void draw_caps_lines_at_the_hebrew_letter_budget()
    {
        var text = string.Join(' ', Enumerable.Range(0, 40)
            .Select(i => new string([(char)('א' + i % 22), (char)('א' + i / 22)])));
        using var rig = new Rig(text);
        var lines = rig.Draw(10000).Where(p => !p.IsMark)
            .GroupBy(p => (int)((p.Y - 8) / (18 * 1.4f))).OrderBy(g => g.Key);
        lines.Select(line => line.Select(p => p.Text).Distinct().Sum(TikkunFlowLayout.HebrewLetters))
            .Should().Equal(33, 34, 14);
    }

    [Fact]
    public void theme_changes_recolor_the_same_glyph_geometry()
    {
        var previous = Application.Current;
        try
        {
            Application.Current = new Application { UserAppTheme = AppTheme.Light };
            using var rig = new Rig("וַיַּ֧רְא");
            var light = rig.Draw().First(p => p.Text == "וַיַּ֧רְא" && !p.IsMark);
            Application.Current.UserAppTheme = AppTheme.Dark;
            rig.View.OnAppRequestedThemeChanged(null, new AppThemeChangedEventArgs(AppTheme.Dark));
            var dark = rig.Draw().First(p => p.Text == light.Text && !p.IsMark);
            dark.Path.Should().BeSameAs(light.Path);
            dark.Color.Should().Be(Color.FromArgb("#e0e0e0"));
            light.Color.Should().Be(Color.FromArgb("#1a1a1a"));
        }
        finally
        {
            Application.Current = previous;
        }
    }
}
