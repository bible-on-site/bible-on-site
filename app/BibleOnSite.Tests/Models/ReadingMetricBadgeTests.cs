using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Models;

/// <summary>
/// The "זמן קריאה משוער: X" badge contract every metric-carrying model shares
/// (issue #2607): a stored estimate formats through
/// <see cref="Helpers.ReadingTimeFormatter"/>; a missing metric renders
/// nothing so the badge hides rather than inventing a duration.
/// </summary>
public sealed class ReadingMetricBadgeTests
{
    private const string ExpectedBadge = "זמן קריאה משוער: 4 דקות";

    private static readonly ReadingMetric Metric = new()
    {
        WordCount = 880,
        EstimatedSeconds = 240,
        WordsPerMinute = 220,
        CalcVersion = 1,
        SourceHash = "hash",
    };

    private static Perek Perek(ReadingMetric? metric = null) => new()
    {
        Date = "2026-01-20",
        HebDate = "תשרי",
        SeferName = "בראשית",
        SeferTanahUsName = "Genesis",
        Tseit = "18:00",
        ReadingMetric = metric,
    };

    private static Article Article(ReadingMetric? metric = null) => new()
    {
        Abstract = "Test",
        ReadingMetric = metric,
    };

    [Fact]
    public void Perek_ReadingTimeBadge_FormatsTheStoredEstimate()
    {
        Perek(Metric).ReadingTimeBadge.Should().Be(ExpectedBadge);
    }

    [Fact]
    public void Perek_ReadingTimeBadge_HidesWithoutMetric()
    {
        Perek().ReadingTimeBadge.Should().BeNull();
    }

    [Fact]
    public void Article_ReadingTimeBadge_FormatsTheStoredEstimate()
    {
        Article(Metric).ReadingTimeBadge.Should().Be(ExpectedBadge);
    }

    [Fact]
    public void Article_ReadingTimeBadge_HidesWithoutMetric()
    {
        Article().ReadingTimeBadge.Should().BeNull();
    }

    [Fact]
    public void Perush_ReadingTimeBadge_FormatsTheStoredEstimate()
    {
        new Perush { Name = "Rashi", ReadingMetric = Metric }
            .ReadingTimeBadge.Should().Be(ExpectedBadge);
    }

    [Fact]
    public void Perush_ReadingTimeBadge_HidesWithoutMetric()
    {
        new Perush { Name = "Rashi" }.ReadingTimeBadge.Should().BeNull();
    }

    [Fact]
    public void TanahpediaEntryDetail_ReadingTimeBadge_FormatsTheStoredEstimate()
    {
        new TanahpediaEntryDetail { ReadingMetric = Metric }
            .ReadingTimeBadge.Should().Be(ExpectedBadge);
    }

    [Fact]
    public void TanahpediaEntryDetail_ReadingTimeBadge_HidesWithoutMetric()
    {
        new TanahpediaEntryDetail().ReadingTimeBadge.Should().BeNull();
    }

    [Fact]
    public void ReadingTimeBadge_VerifiedEmptyBody_RendersNothing()
    {
        // 0 seconds = verified-empty body — never fabricate a minute.
        var empty = Metric with { EstimatedSeconds = 0 };

        Perek(empty).ReadingTimeBadge.Should().BeNull();
    }
}
