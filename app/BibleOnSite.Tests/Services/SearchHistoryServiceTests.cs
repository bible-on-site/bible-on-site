using BibleOnSite.Services;

namespace BibleOnSite.Tests.Services;

public class SearchHistoryServiceTests
{
    [Fact]
    public void History_PersistsAcrossInstances_DeduplicatesHebrew_AndKeepsNewestPhrase()
    {
        var storage = new InMemoryPreferencesStorage();
        var history = new SearchHistoryService(storage);
        history.Remember("בראשית");
        history.Remember("שמות");
        history.Remember("  בְּרֵאשִׁית  ");
        new SearchHistoryService(storage).Read().Should().Equal("בְּרֵאשִׁית", "שמות");
    }

    [Fact]
    public void History_IsBounded_AndIgnoresEmptyInput()
    {
        var history = new SearchHistoryService(new InMemoryPreferencesStorage());
        foreach (var number in Enumerable.Range(1, 25))
        {
            history.Remember($"פרק {number}");
        }
        history.Remember(" ");
        history.Read().Should().HaveCount(20).And.StartWith("פרק 25").And.EndWith("פרק 6");
    }

    [Fact]
    public void CorruptHistory_DoesNotBreakSearch_AndIsReplacedOnNextSearch()
    {
        var storage = new InMemoryPreferencesStorage();
        storage.Set("RecentSearches.v1", "not json");
        var history = new SearchHistoryService(storage);
        history.Read().Should().BeEmpty();
        history.Remember("תהלים");
        history.Read().Should().Equal("תהלים");
    }
}
