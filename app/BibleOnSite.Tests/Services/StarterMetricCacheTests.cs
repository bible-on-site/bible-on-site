using System.Text.Json;
using BibleOnSite.Services;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// The starter cache is the offline article source — the stored reading
/// metric rides the same serialized response so offline starts keep the
/// badge (issue #2607).
/// </summary>
public sealed class StarterMetricCacheTests
{
    [Fact]
    public void StarterCache_RoundTripsTheReadingMetric()
    {
        var response = new StarterService.StarterResponse(
            new StarterService.StarterData(
                [new StarterService.AuthorData(1, 1, "", "author")],
                [new StarterService.ArticleData(7, 9, 1, "<H1>a</H1>", "name", 10,
                    new StarterService.ReadingMetricData(361, 99, 220, 1, "hash"))],
                [0, 1]));

        var json = JsonSerializer.Serialize(response, StarterJsonContext.Default.StarterResponse);
        var restored = JsonSerializer.Deserialize(json, StarterJsonContext.Default.StarterResponse);

        restored.Should().NotBeNull();
        var metric = restored!.Starter.Articles[0].ReadingMetric;
        metric.Should().NotBeNull();
        metric!.WordCount.Should().Be(361);
        metric.EstimatedSeconds.Should().Be(99);
        metric.WordsPerMinute.Should().Be(220);
        metric.ToModel().EstimatedSeconds.Should().Be(99);
    }

    [Fact]
    public void StarterCache_ToleratesMissingMetricOnOlderSnapshots()
    {
        // A cache written before #2607 deserializes with a null metric —
        // the badge hides rather than the whole snapshot being rejected.
        var response = new StarterService.StarterResponse(
            new StarterService.StarterData(
                [],
                [new StarterService.ArticleData(7, 9, 1, null, "name", 10, null)],
                []));

        var model = response.Starter.Articles[0].ReadingMetric;

        model.Should().BeNull();
    }
}
