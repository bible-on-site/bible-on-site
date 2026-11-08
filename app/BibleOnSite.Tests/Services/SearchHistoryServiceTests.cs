using BibleOnSite.Services;

namespace BibleOnSite.Tests.Services;

public class SearchHistoryServiceTests
{
    [Fact]
    public void NullStoredHistory_RecoversOnTheNextSearch()
    {
        var storage = new InMemoryPreferencesStorage();
        storage.Set("RecentSearches.v1", "null");
        var history = new SearchHistoryService(storage);
        history.Read().Should().BeEmpty();
        history.Remember("שמות");
        history.Read().Should().Equal("שמות");
    }

    [Fact]
    public void StoredHistory_DropsNullBlankAndOversizedEntries()
    {
        var storage = new InMemoryPreferencesStorage();
        storage.Set("RecentSearches.v1", $"[null,\" \",\"{new string('א', 513)}\",\"בראשית\",\"בְּרֵאשִׁית\"]");
        new SearchHistoryService(storage).Read().Should().Equal("בראשית");
    }

    [Fact]
    public void OversizedQuery_DoesNotReplaceRecentSearches()
    {
        var storage = new InMemoryPreferencesStorage();
        var history = new SearchHistoryService(storage);
        history.Remember("שמות");
        var saved = storage.Get("RecentSearches.v1", "");
        history.Remember(new string('א', 513));
        storage.Get("RecentSearches.v1", "").Should().Be(saved);
        history.Read().Should().Equal("שמות");
    }

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
