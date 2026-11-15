using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

public class ReaderHeaderScrollStateTests
{
    [Fact]
    public void DownwardMovementAccumulatesBeforeHiding()
    {
        var state = new ReaderHeaderScrollState();
        Assert.True(state.Update(5));
        Assert.True(state.Update(6));
        Assert.False(state.Update(2));
    }

    [Fact]
    public void SmallUpwardMovementRevealsHeaderInMiddleOfChapter()
    {
        var state = new ReaderHeaderScrollState();
        Assert.False(state.Update(600));
        Assert.True(state.Update(-1));
        Assert.True(state.Update(0));
    }

    [Fact]
    public void DirectionChangeStartsANewDownwardDistance()
    {
        var state = new ReaderHeaderScrollState();
        state.Update(11);
        state.Update(-1);
        Assert.True(state.Update(5));
        Assert.False(state.Update(8));
    }

    [Fact]
    public void SelectionKeepsActionsVisibleDespiteScrolling()
    {
        var state = new ReaderHeaderScrollState();
        state.Update(50);
        Assert.True(state.Update(200, keepVisible: true));
        Assert.True(state.Update(4));
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void ChapterRecitationAndPlaybackKeepActionsVisibleWithoutSelectedVerses(bool chapterRecitation, bool playing)
    {
        var state = new ReaderHeaderScrollState();
        state.Update(50);
        var active = ReaderSurfaceState.IsActive(0, chapterRecitation, focusedPasuk: false, playing);

        Assert.True(state.Update(200, keepVisible: active));
    }

    [Fact]
    public void ChapterResetRestoresHeader()
    {
        var state = new ReaderHeaderScrollState();
        state.Update(90);
        state.Reset();
        Assert.True(state.IsVisible);
        Assert.True(state.Update(2));
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void InvalidOffsetsCannotChangeVisibility(double delta)
    {
        var state = new ReaderHeaderScrollState();
        Assert.True(state.Update(delta));
        state.Update(50);
        Assert.False(state.Update(delta));
    }
}
