using BibleOnSite.Helpers;
using Xunit;

namespace BibleOnSite.Tests.Helpers;

public sealed class TextViewportTests
{
    [Theory]
    [InlineData(100000, 50000, 50800, 50000, 800)]
    [InlineData(100000, -200, 600, 0, 600)]
    [InlineData(100000, 99600, 100400, 99600, 400)]
    [InlineData(300, -200, 600, 0, 300)]
    [InlineData(100000, -800, -100, 0, 0)]
    [InlineData(300, 400, 1200, 300, 0)]
    [InlineData(100000, 800, 500, 800, 0)]
    public void DocumentHeightDoesNotExpandTheVisibleNativeTextArea(
        double documentHeight, double top, double bottom, double expectedOffset, double expectedHeight)
    {
        var result = TextViewport.Clip(documentHeight, top, bottom);
        Assert.Equal(expectedOffset, result.Offset);
        Assert.Equal(expectedHeight, result.Height);
        Assert.InRange(result.Height, 0, documentHeight);
    }

    [Theory]
    [InlineData(0, 0, 800)]
    [InlineData(double.NaN, 0, 800)]
    [InlineData(double.PositiveInfinity, 0, 800)]
    [InlineData(100000, double.NaN, 800)]
    public void UnmeasuredGeometryHasNoVisibleTextArea(double height, double top, double bottom)
    {
        Assert.Equal(default, TextViewport.Clip(height, top, bottom));
    }
}
