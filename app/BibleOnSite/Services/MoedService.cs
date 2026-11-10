using System.Text.Json;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using GraphQL.Client.Http;

namespace BibleOnSite.Services;

/// <summary>
/// The מועדים על הפרק catalogue service (#3261): the public GraphQL
/// <c>moadim</c>/<c>moed(slug)</c> reads — never the admin operations — with
/// the same API → local-cache → empty offline pattern as
/// <see cref="StarterService"/>. The catalogue response carries each moed's
/// ordered sections and ranges plus the server-resolved article union, so a
/// cached load keeps detail pages fully usable offline, and a catalogue
/// edit reaches the app on the next refresh with no app-store release.
/// </summary>
public class MoedService : BaseGraphQLService
{
    private static readonly Lazy<MoedService> _instance = new(() => new MoedService());

    /// <summary>Singleton instance of the MoedService.</summary>
    public static MoedService Instance => _instance.Value;

    private const string CacheFileName = "moadim_cache.json";

    private readonly IFileSystem _fileSystem;

    private MoedService()
    {
        _fileSystem = FileSystem.Current;
    }

    public MoedService(GraphQLHttpClient client, IFileSystem fileSystem) : base(client)
    {
        _fileSystem = fileSystem;
    }

    /// <summary>Published moadim in annual order, loaded from the API or cache.</summary>
    public List<MoedUnit> Moadim { get; private set; } = [];

    /// <summary>Whether catalogue data has been successfully loaded (API or cache).</summary>
    public bool IsLoaded { get; private set; }

    /// <summary>True when data was loaded from local cache rather than the API.</summary>
    public bool IsFromCache { get; private set; }

    /// <summary>
    /// The catalogue's full detail read — everything the list and detail
    /// pages need in one round trip, so browsing issues no per-moed or
    /// per-verse requests. <c>articles { id }</c> is the server-side union
    /// (range-linked first, explicit-only afterward, deduplicated); only ids
    /// are fetched — article content joins the StarterService cache.
    /// </summary>
    private const string MoedFields = """
        id
        slug
        name
        summary
        hebrewMonth
        dateLabel
        annualOrder
        published
        sections {
            id
            label
            position
            ranges {
                id
                position
                perekIdStart
                pasukStart
                perekIdEnd
                pasukEnd
            }
        }
        explicitArticleIds
        articles { id }
        """;

    private static readonly string GetMoadimQuery = $$"""
        query GetMoadim {
            moadim {
        {{Indent(MoedFields)}}
            }
        }
        """;

    private static readonly string GetMoedQuery = $$"""
        query GetMoed($slug: String!) {
            moed(slug: $slug) {
        {{Indent(MoedFields)}}
            }
        }
        """;

    private static string Indent(string fields) =>
        string.Join('\n', fields.Split('\n').Select(line => $"                {line.TrimEnd()}"));

    /// <summary>
    /// Loads the catalogue: API once, then local cache, else empty so the
    /// list page can surface its unavailable state. Never blocks indefinitely.
    /// </summary>
    public async Task LoadWithRetryAsync()
    {
        if (IsLoaded)
        {
            return;
        }

        try
        {
            await LoadFromApiAsync();
            if (IsLoaded)
            {
                return;
            }
        }
        #pragma warning disable S2221 // Deliberate failure boundary: moadim API failure falls back to local cache
        catch (Exception ex) //NOSONAR — moadim API failure falls back to local cache.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Moadim API unavailable: {ex}");
        }

        try
        {
            if (await LoadFromCacheAsync())
            {
                return;
            }
        }
        #pragma warning disable S2221 // Deliberate failure boundary: cache load failure proceeds with an empty catalogue
        catch (Exception ex) //NOSONAR — cache load failure proceeds with an empty catalogue.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Moadim cache load failed: {ex}");
        }

        Console.WriteLine("No moadim catalogue available — the list stays empty until a refresh succeeds");
    }

    /// <summary>Refreshes the catalogue from the API on connectivity recovery.</summary>
    public async Task TryRefreshAsync()
    {
        try
        {
            await LoadFromApiAsync();
        }
        #pragma warning disable S2221 // Deliberate failure boundary: background refresh failure is log-only
        catch (Exception ex) //NOSONAR — background refresh failure is log-only.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Moadim refresh failed: {ex}");
        }
    }

    /// <summary>
    /// Resolves a moed by slug — cached first; a miss (e.g. a moed added
    /// since the last refresh, deep-linked directly) fetches the detail read
    /// and merges it into the catalogue so the cache stays current.
    /// </summary>
    public async Task<MoedUnit?> GetMoedBySlugAsync(string slug)
    {
        if (GetMoedBySlug(slug) is { } cached)
        {
            return cached;
        }

        var response = await QueryWithTimeoutAsync<MoedResponse>(
            GetMoedQuery, TimeSpan.FromSeconds(5), "GetMoed",
            new Dictionary<string, object?> { ["slug"] = slug });
        if (response?.Moed is not { } data || !data.Published)
        {
            return null;
        }

        var moed = ToModel(data);
        Moadim = Moadim.Where(existing => existing.Id != moed.Id)
            .Append(moed)
            .OrderBy(m => m.AnnualOrder)
            .ToList();
        await SaveCacheAsync(new MoadimResponse(Moadim.Select(ToData).ToList()));
        return moed;
    }

    /// <summary>The moed with the given DB id, or null.</summary>
    public MoedUnit? GetMoed(int id) => Moadim.FirstOrDefault(m => m.Id == id);

    /// <summary>The moed with the given slug (cached catalogue only), or null.</summary>
    public MoedUnit? GetMoedBySlug(string slug) =>
        Moadim.FirstOrDefault(m => m.Slug == slug);

    /// <summary>The previous/next moadim in annual order around the given id.</summary>
    public (MoedUnit? Prev, MoedUnit? Next) GetAdjacentMoadim(int id)
    {
        var index = Moadim.FindIndex(m => m.Id == id);
        if (index < 0)
        {
            return (null, null);
        }
        return (index > 0 ? Moadim[index - 1] : null,
            index < Moadim.Count - 1 ? Moadim[index + 1] : null);
    }

    /// <summary>Fetches the catalogue and caches the result locally.</summary>
    private async Task LoadFromApiAsync()
    {
        var response = await QueryWithTimeoutAsync<MoadimResponse>(
            GetMoadimQuery, TimeSpan.FromSeconds(5), "GetMoadim");

        if (response?.Moadim == null)
        {
            return;
        }

        ApplyResponse(response.Moadim);
        IsFromCache = false;
        IsLoaded = true;

        // Finish persisting before reporting a completed load, so immediate
        // offline restarts keep the catalogue (same contract as StarterService).
        await SaveCacheAsync(response);
    }

    private void ApplyResponse(List<MoedData> moadim)
    {
        // The public resolvers already serve published only; the flag rides
        // the payload so a draft that ever leaks into a cached response
        // still resolves as unavailable here.
        Moadim = moadim.Where(m => m.Published).Select(ToModel)
            .OrderBy(m => m.AnnualOrder)
            .ToList();
    }

    private static MoedUnit ToModel(MoedData data) => new()
    {
        Id = data.Id,
        Slug = data.Slug,
        Name = data.Name,
        Summary = data.Summary,
        HebrewMonth = data.HebrewMonth,
        DateLabel = data.DateLabel,
        AnnualOrder = data.AnnualOrder,
        Sections = (data.Sections ?? [])
            .OrderBy(s => s.Position)
            .Select(s => new MoedSection
            {
                Id = s.Id,
                Label = s.Label,
                Position = s.Position,
                Ranges = (s.Ranges ?? [])
                    .OrderBy(r => r.Position)
                    .Select(r => new MoedRange
                    {
                        Id = r.Id,
                        Position = r.Position,
                        StartPerekId = r.PerekIdStart,
                        StartPasuk = r.PasukStart,
                        EndPerekId = r.PerekIdEnd,
                        EndPasuk = r.PasukEnd,
                    }).ToList(),
            }).ToList(),
        // The union order is the server's: range-linked articles first,
        // explicit-only ones afterward — already deduplicated, kept so
        // defensively (Distinct preserves first-seen order).
        ArticleIds = (data.Articles ?? []).Select(a => a.Id).Distinct().ToList(),
    };

    private static MoedData ToData(MoedUnit moed) => new(
        moed.Id, moed.Slug, moed.Name, moed.Summary, moed.HebrewMonth, moed.DateLabel,
        moed.AnnualOrder, true,
        moed.Sections.Select(s => new MoedSectionData(s.Id, s.Label, s.Position,
            s.Ranges.Select(r => new MoedRangeData(r.Id, r.Position,
                r.StartPerekId, r.StartPasuk, r.EndPerekId, r.EndPasuk)).ToList())).ToList(),
        null,
        moed.ArticleIds.Select(id => new MoedArticleRef(id)).ToList());

    #region Local cache

    private string CachePath =>
        Path.Join(_fileSystem.AppDataDirectory, CacheFileName);

    private async Task SaveCacheAsync(MoadimResponse response)
    {
        try
        {
            var json = JsonSerializer.Serialize(response, MoedJsonContext.Default.MoadimResponse);
            await AtomicFile.WriteAllTextAsync(CachePath, json);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: cache save is best-effort
        catch (Exception ex) //NOSONAR — cache save is best-effort.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Failed to save moadim cache: {ex}");
        }
    }

    private async Task<bool> LoadFromCacheAsync()
    {
        if (!File.Exists(CachePath))
        {
            return false;
        }

        var json = await File.ReadAllTextAsync(CachePath);
        var response = JsonSerializer.Deserialize(json, MoedJsonContext.Default.MoadimResponse);
        if (response?.Moadim == null)
        {
            return false;
        }

        ApplyResponse(response.Moadim);
        IsFromCache = true;
        IsLoaded = true;
        return true;
    }

    #endregion

    #region DTOs for GraphQL response and local cache

    // Records used for both GraphQL deserialization and local JSON cache:
    // MoedJsonContext handles the cache, GraphQLJsonContext the client.
    internal record MoadimResponse(List<MoedData> Moadim);
    internal record MoedResponse(MoedData? Moed);

    internal record MoedData(
        int Id,
        string Slug,
        string Name,
        string? Summary,
        string? HebrewMonth,
        string? DateLabel,
        int AnnualOrder,
        bool Published,
        List<MoedSectionData>? Sections,
        List<int>? ExplicitArticleIds,
        List<MoedArticleRef>? Articles);

    internal record MoedSectionData(
        int Id,
        string Label,
        int Position,
        List<MoedRangeData>? Ranges);

    internal record MoedRangeData(
        int Id,
        int Position,
        int PerekIdStart,
        int PasukStart,
        int PerekIdEnd,
        int PasukEnd);

    /// <summary>One article id inside the server-resolved union.</summary>
    internal record MoedArticleRef(int Id);

    #endregion
}

/// <summary>
/// System.Text.Json source generator for the moadim cache file — same
/// trimming-safe pattern as StarterJsonContext.
/// </summary>
[System.Text.Json.Serialization.JsonSerializable(typeof(MoedService.MoadimResponse))]
#pragma warning disable S2333 // System.Text.Json source generation supplies this partial implementation.
internal partial class MoedJsonContext : System.Text.Json.Serialization.JsonSerializerContext { }
#pragma warning restore S2333
