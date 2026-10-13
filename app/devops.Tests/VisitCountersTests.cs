using System.Text.Json;
using AltCover.Recorder;
using Xunit;

public sealed class VisitCountersTests
{
    [Fact]
    public void PreservesSignedPointIdsAcrossBlockBoundariesWithoutZeroHits()
    {
        var counters = new VisitCounters();
        var points = new[] { int.MinValue, int.MinValue + 1023, int.MinValue + 1024, -1, 0, 1023, 1024, int.MaxValue };
        foreach (var point in points) { counters.Visit("module", point); counters.Visit("module", point); }
        using var report = JsonDocument.Parse(counters.SnapshotJson());
        Assert.Equal("altcover-visits/1", report.RootElement.GetProperty("format").GetString());
        var hits = report.RootElement.GetProperty("modules").GetProperty("module");
        Assert.Equal(points.Length, hits.EnumerateObject().Count());
        foreach (var point in points) { Assert.Equal(2, hits.GetProperty(point.ToString()).GetInt64()); }
    }

    [Fact]
    public void ConcurrentVisitsPreserveExactCountsInEachModuleAndBranch()
    {
        var counters = new VisitCounters();
        Parallel.For(0, 8, worker => {
            for (var visit = 0; visit < 100000; visit++) {
                counters.Visit(worker % 2 == 0 ? "first" : "second", visit % 1024);
                counters.Visit(worker % 2 == 0 ? "first" : "second", int.MinValue + visit % 1024);
            }
        });
        using var report = JsonDocument.Parse(counters.SnapshotJson());
        foreach (var name in new[] { "first", "second" }) {
            var hits = report.RootElement.GetProperty("modules").GetProperty(name);
            Assert.Equal(800000L, hits.EnumerateObject().Sum(point => point.Value.GetInt64()));
            for (var point = 0; point < 1024; point++) {
                var expected = 4L * (100000 / 1024 + (point < 100000 % 1024 ? 1 : 0));
                Assert.Equal(expected, hits.GetProperty(point.ToString()).GetInt64());
                Assert.Equal(expected, hits.GetProperty((int.MinValue + point).ToString()).GetInt64());
            }
        }
    }

    [Fact]
    public void ResetStartsAnEmptyGenerationAndKeepsNewVisits()
    {
        var counters = new VisitCounters();
        counters.Visit("old", 10);
        counters.Visit("old", int.MinValue + 10);
        counters.Reset();
        using var empty = JsonDocument.Parse(counters.SnapshotJson());
        Assert.Empty(empty.RootElement.GetProperty("modules").EnumerateObject());
        counters.Visit("new", 10);
        using var fresh = JsonDocument.Parse(counters.SnapshotJson());
        var modules = fresh.RootElement.GetProperty("modules");
        Assert.Single(modules.EnumerateObject());
        Assert.Equal(1, modules.GetProperty("new").GetProperty("10").GetInt64());
    }

    [Fact]
    public async Task SnapshotsAndResetsRemainValidDuringConcurrentRecording()
    {
        var counters = new VisitCounters();
        using var stop = new CancellationTokenSource();
        using var started = new ManualResetEventSlim();
        var writer = Task.Run(() => {
            counters.Visit("module", 42);
            started.Set();
            while (!stop.IsCancellationRequested) { counters.Visit("module", 42); }
        });
        try {
            Assert.True(started.Wait(TimeSpan.FromSeconds(5)));
            for (var iteration = 0; iteration < 1000; iteration++) {
                using var snapshot = JsonDocument.Parse(counters.SnapshotJson());
                Assert.Equal("altcover-visits/1", snapshot.RootElement.GetProperty("format").GetString());
                counters.Reset();
            }
        } finally { stop.Cancel(); await writer; }
    }
}
