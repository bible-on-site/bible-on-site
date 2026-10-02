using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Tests.Helpers;

public class CoverageEdgeCasesTests
{
    [Fact]
    public void Swipe_WithoutAnyPages_DoesNotNavigate()
    {
        var tracker = new SwipeNavigationTracker();
        tracker.Begin(new TouchPosition(0, 0, 0), 0);
        tracker.End(new TouchPosition(100, 0, 100), 400, 10, 100, false, 0).Should().BeNull();
    }

    [Fact]
    public void MissingBookPart_ReturnsEmptyMetadata()
    {
        new Sefer { Name = "שמואל", TanahUsName = new Dictionary<int, string> { [1] = "I_Samuel" } }
            .GetTanahUsName(9).Should().BeEmpty();
        BibleOnSite.Data.PerakimData.GetPerakimCount(8, 9).Should().Be(0);
    }

    [Fact]
    public void Gematria_WithPunctuation_IgnoresNonHebrewCharacters()
    {
        GimatryHelper.ToNumberWithMantzpach("א! ך?").Should().Be(501);
    }

    [Fact]
    public void MediaExtraction_DropsStandaloneBreaksAroundMedia()
    {
        var segments = HtmlMediaExtractor.ExtractSegments("<br><audio src='https://example.test/audio.mp3'></audio><br/>");
        segments.Should().ContainSingle().Which.Kind.Should().Be(SegmentKind.Media);
    }

    [Fact]
    public void WeekendAdjustment_WithInvalidCalendarDate_PreservesInput()
    {
        HebrewDateHelper.AdjustForWeekend((5784, 99, 99), DayOfWeek.Friday).Should().Be((5784, 99, 99));
        HebrewDateHelper.LegacyMonthToCalendar(5784, 99).Should().Be(99);
    }

    [Fact]
    public void UnknownVerseSegment_ThrowsInsteadOfSilentlyLosingText()
    {
        var verse = new Pasuk { PasukNum = 1, Text = "text", Segments = [new PasukSegment { Type = (SegmentType)99, Value = "text" }] };
        FluentActions.Invoking(() => verse.FormattedText).Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void HtmlView_UnknownAlignment_UsesCssStartFallback()
    {
        new HtmlView { TextAlignment = (HtmlTextAlignment)99 }.GetCssTextAlign().Should().Be("start");
    }
}
