using System.Text.Json;
using System.Text.Json.Serialization;
using BibleOnSite.Helpers;

namespace BibleOnSite.Services;

public sealed class SearchHistoryService(IPreferencesStorage storage)
{
    private const string StorageKey = "RecentSearches.v1";
    private const int MaximumItems = 20;

    public IReadOnlyList<string> Read()
    {
        try
        {
            return (JsonSerializer.Deserialize(storage.Get(StorageKey, "[]"), SearchHistoryJsonContext.Default.ListString) ?? [])
                .Where(phrase => !string.IsNullOrWhiteSpace(phrase) && phrase.Length <= 512)
                .DistinctBy(SearchText.Normalize).Take(MaximumItems).ToArray();
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public void Remember(string phrase)
    {
        phrase = phrase.Trim();
        if (phrase.Length is 0 or > 512)
        {
            return;
        }
        var normalized = SearchText.Normalize(phrase);
        var items = Read().Where(item => SearchText.Normalize(item) != normalized).Prepend(phrase).Take(MaximumItems).ToList();
        storage.Set(StorageKey, JsonSerializer.Serialize(items, SearchHistoryJsonContext.Default.ListString));
    }
}

[JsonSerializable(typeof(List<string>))]
internal partial class SearchHistoryJsonContext : JsonSerializerContext;
