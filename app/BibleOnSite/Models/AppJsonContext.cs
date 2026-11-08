using System.Text.Json.Serialization;
using BibleOnSite.Services;

namespace BibleOnSite.Models;

// Native release builds cannot rely on reflection to read persisted app data.
[JsonSerializable(typeof(Dictionary<int, string>), TypeInfoPropertyName = "PerushCatalog")]
[JsonSerializable(typeof(int[]), TypeInfoPropertyName = "BookmarkedPerakim")]
[JsonSerializable(typeof(List<string>), TypeInfoPropertyName = "RecentSearches")]
[JsonSerializable(typeof(Dictionary<string, string>), TypeInfoPropertyName = "SeferNames")]
[JsonSerializable(typeof(Dictionary<string, PreferenceStamp>), TypeInfoPropertyName = "PreferenceStamps")]
#pragma warning disable S2333 // System.Text.Json source generation supplies this partial implementation.
public partial class AppJsonContext : JsonSerializerContext;
#pragma warning restore S2333
