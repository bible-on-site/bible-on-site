using BibleOnSite.Helpers;
using Xunit;

namespace BibleOnSite.Tests.Helpers;

public sealed class TextSectionGeometryCacheTests
{
    [Fact]
    public void SnapshotReadsReuseOneCompleteMeasurementAtTheCurrentWidth()
    {
        var cache = new TextSectionGeometryCache<string>();
        var request = cache.Begin(358, 2)!.Value;
        Assert.Null(cache.Begin(358, 2));
        Assert.False(cache.TryGet(0, 358, out _));
        Assert.True(cache.Complete(request, ["first paragraph", "last paragraph"]));
        Assert.Null(cache.Begin(358, 2));
        Assert.True(cache.TryGet(1, 358, out var last));
        Assert.Equal("last paragraph", last);
        Assert.False(cache.TryGet(2, 358, out _));
    }

    [Fact]
    public void RotationRejectsTheOldWidthCompletionAndFrames()
    {
        var cache = new TextSectionGeometryCache<int>();
        var portrait = cache.Begin(358, 1)!.Value;
        var landscape = cache.Begin(780, 1)!.Value;
        Assert.False(cache.Complete(portrait, [10]));
        Assert.True(cache.Complete(landscape, [20]));
        Assert.False(cache.TryGet(0, 358, out _));
        Assert.True(cache.TryGet(0, 780, out var frame));
        Assert.Equal(20, frame);
    }

    [Fact]
    public void ReturningToCachedWidthCancelsAnInterimRotation()
    {
        var cache = new TextSectionGeometryCache<int>();
        cache.Complete(cache.Begin(358, 1)!.Value, [10]);
        var landscape = cache.Begin(780, 1)!.Value;
        Assert.Null(cache.Begin(358, 1));
        Assert.False(cache.Complete(landscape, [20]));
        Assert.True(cache.TryGet(0, 358, out var frame));
        Assert.Equal(10, frame);
    }

    [Fact]
    public void RecycledDocumentRejectsAnOldCompletionEvenAtTheSameWidth()
    {
        var cache = new TextSectionGeometryCache<int>();
        var old = cache.Begin(358, 1)!.Value;
        cache.Reset();
        var current = cache.Begin(358, 2)!.Value;
        Assert.False(cache.Complete(old, [10]));
        Assert.True(cache.Complete(current, [20, 30]));
        cache.Reset();
        Assert.False(cache.TryGet(0, 358, out _));
    }

    [Fact]
    public void IncompleteGeometryAndInvalidWidthsCannotBecomeSnapshotFrames()
    {
        var cache = new TextSectionGeometryCache<int>();
        Assert.Null(cache.Begin(double.NaN, 2));
        Assert.Null(cache.Begin(double.PositiveInfinity, 2));
        Assert.Null(cache.Begin(0, 2));
        var request = cache.Begin(358, 2)!.Value;
        Assert.Throws<ArgumentException>(() => cache.Complete(request, [10]));
        Assert.False(cache.TryGet(0, 358, out _));
    }
}
