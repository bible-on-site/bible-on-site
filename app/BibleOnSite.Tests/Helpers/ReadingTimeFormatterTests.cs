using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// The app mirror of the website's formatEstimatedReadingTime contract
/// (#2607): unknown and verified-empty render nothing, sub-minute hedges,
/// whole minutes round up.
/// </summary>
public sealed class ReadingTimeFormatterTests
{
    [Fact]
    public void NullEstimate_RendersNothing()
    {
        ReadingTimeFormatter.FormatEstimatedReadingTime(null).Should().BeNull();
        ReadingTimeFormatter.FormatReadingTimeLabel(null).Should().BeNull();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-30)]
    public void EmptyOrInvalidEstimate_RendersNothing(int seconds)
    {
        // 0 = verified-empty body: never fabricate a minute.
        ReadingTimeFormatter.FormatEstimatedReadingTime(seconds).Should().BeNull();
        ReadingTimeFormatter.FormatReadingTimeLabel(seconds).Should().BeNull();
    }

    [Theory]
    [InlineData(1)]
    [InlineData(45)]
    [InlineData(59)]
    public void UnderOneMinute_ShowsTheSubMinuteHedge(int seconds)
    {
        ReadingTimeFormatter.FormatEstimatedReadingTime(seconds).Should().Be("פחות מדקה");
    }

    [Theory]
    [InlineData(60, "דקה")]
    [InlineData(61, "2 דקות")]
    [InlineData(119, "2 דקות")]
    [InlineData(120, "2 דקות")]
    [InlineData(121, "3 דקות")]
    [InlineData(240, "4 דקות")]
    [InlineData(600, "10 דקות")]
    public void WholeMinutesRoundUp(int seconds, string expected)
    {
        ReadingTimeFormatter.FormatEstimatedReadingTime(seconds).Should().Be(expected);
    }

    [Fact]
    public void Label_PrefixesTheCanonicalCaption()
    {
        ReadingTimeFormatter.FormatReadingTimeLabel(240)
            .Should().Be($"{ReadingTimeFormatter.EstimateLabel}: 4 דקות");
        ReadingTimeFormatter.EstimateLabel.Should().Be("זמן קריאה משוער");
    }
}
