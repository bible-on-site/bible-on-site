using BibleOnSite.Services;

namespace BibleOnSite.Tests.Services;

public class PreferencesBoundaryTests
{
    [Fact]
    public void Storage_IsRequired()
    {
        FluentActions.Invoking(() => PreferencesService.CreateForTesting(null!)).Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void LastLearnt_UnchangedValue_DoesNotNotifyOrWriteAgain()
    {
        var storage = new Mock<IPreferencesStorage>();
        var service = PreferencesService.CreateForTesting(storage.Object);
        service.LastLearntPerek = 5;
        var changes = 0;
        service.PreferencesChanged += (_, _) => changes++;
        service.LastLearntPerek = 5;
        changes.Should().Be(0);
        storage.Verify(s => s.Set("lastLearntPerek", 5), Times.Once);
    }

    [Fact]
    public void NullBookmarks_LoadsEmptySet_AndToggleRemovesExistingBookmark()
    {
        var storage = new InMemoryPreferencesStorage();
        storage.Set("bookmarkedPerakim", "null");
        var service = PreferencesService.CreateForTesting(storage);
        service.Load();
        service.BookmarkedPerakim.Should().BeEmpty();
        service.ToggleBookmark(5);
        service.IsBookmarked(5).Should().BeTrue();
        service.ToggleBookmark(5);
        service.IsBookmarked(5).Should().BeFalse();
    }
}
