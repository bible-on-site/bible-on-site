namespace BibleOnSite.Models;

/// <summary>
/// One node in the Tanahpedia category taxonomy — mirrors the website's
/// <c>CATEGORY_HIERARCHY</c>/<c>CATEGORY_LABELS</c> so the landing grid and the
/// category pages show the same taxonomy and Hebrew labels.
/// </summary>
public class TanahpediaCategory
{
    /// <summary>Category key (PERSON, PLACE, PROPHET, WAR, …).</summary>
    public required string Key { get; init; }

    /// <summary>Hebrew display label (אישים, מקומות, נביאים, מלחמות, …).</summary>
    public required string Label { get; init; }

    /// <summary>
    /// Base entity type the listing query runs against. Subcategories such as
    /// WAR or TANAH_SEFER are entity types of their own, so this equals
    /// <see cref="Key"/> for every category except the PROPHET/KING person
    /// roles and the ANIMAL kind/purity filters, which carry the parent type.
    /// </summary>
    public required string EntityType { get; init; }

    /// <summary>
    /// Subcategory filter passed to the API — only for PROPHET/KING (under
    /// PERSON) and BEHEMA/CHAYA/OF/SHERETZ/TAHOR/TAMEH (under ANIMAL);
    /// null for plain entity-type listings.
    /// </summary>
    public string? Sub { get; init; }

    /// <summary>Nested subcategories — the website's landing hierarchy.</summary>
    public IReadOnlyList<TanahpediaCategory> Children { get; init; } = [];

    public bool HasChildren => Children.Count > 0;
}

/// <summary>
/// The Tanahpedia taxonomy — ordered top-level groups with their subcategory
/// children, identical to the website landing page.
/// </summary>
public static class TanahpediaTaxonomy
{
    /// <summary>Top-level categories with their subcategories (website order).</summary>
    public static IReadOnlyList<TanahpediaCategory> Hierarchy { get; } =
    [
        new TanahpediaCategory
        {
            Key = "PERSON", Label = "אישים", EntityType = "PERSON",
            Children =
            [
                new TanahpediaCategory { Key = "PROPHET", Label = "נביאים", EntityType = "PERSON", Sub = "PROPHET" },
                new TanahpediaCategory { Key = "KING", Label = "מלכים", EntityType = "PERSON", Sub = "KING" },
            ]
        },
        new TanahpediaCategory { Key = "PLACE", Label = "מקומות", EntityType = "PLACE" },
        new TanahpediaCategory
        {
            Key = "EVENT", Label = "אירועים", EntityType = "EVENT",
            Children =
            [
                new TanahpediaCategory { Key = "WAR", Label = "מלחמות", EntityType = "WAR" },
            ]
        },
        new TanahpediaCategory
        {
            Key = "SAYING", Label = "אמרות", EntityType = "SAYING",
            Children =
            [
                new TanahpediaCategory { Key = "PROPHECY", Label = "נבואות", EntityType = "PROPHECY" },
            ]
        },
        new TanahpediaCategory
        {
            Key = "OBJECT", Label = "חפצים", EntityType = "OBJECT",
            Children =
            [
                new TanahpediaCategory { Key = "TEMPLE_TOOL", Label = "כלי מקדש", EntityType = "TEMPLE_TOOL" },
                new TanahpediaCategory { Key = "ASTRONOMICAL_OBJECT", Label = "גרמי שמיים", EntityType = "ASTRONOMICAL_OBJECT" },
            ]
        },
        new TanahpediaCategory
        {
            Key = "ANIMAL", Label = "בעלי חיים", EntityType = "ANIMAL",
            Children =
            [
                new TanahpediaCategory { Key = "BEHEMA", Label = "בהמות", EntityType = "ANIMAL", Sub = "BEHEMA" },
                new TanahpediaCategory { Key = "CHAYA", Label = "חיות", EntityType = "ANIMAL", Sub = "CHAYA" },
                new TanahpediaCategory { Key = "OF", Label = "עופות", EntityType = "ANIMAL", Sub = "OF" },
                new TanahpediaCategory { Key = "SHERETZ", Label = "שרצים", EntityType = "ANIMAL", Sub = "SHERETZ" },
                new TanahpediaCategory { Key = "TAHOR", Label = "טהורים", EntityType = "ANIMAL", Sub = "TAHOR" },
                new TanahpediaCategory { Key = "TAMEH", Label = "טמאים", EntityType = "ANIMAL", Sub = "TAMEH" },
            ]
        },
        new TanahpediaCategory { Key = "PLANT", Label = "צמחים", EntityType = "PLANT" },
        new TanahpediaCategory
        {
            Key = "SEFER", Label = "ספרים", EntityType = "SEFER",
            Children =
            [
                new TanahpediaCategory { Key = "TANAH_SEFER", Label = "ספרי תנ\"ך", EntityType = "TANAH_SEFER" },
            ]
        },
        new TanahpediaCategory { Key = "NATION", Label = "עמים", EntityType = "NATION" },
    ];

    private static readonly IReadOnlyDictionary<string, TanahpediaCategory> _byKey =
        Hierarchy
            .SelectMany(cat => cat.Children.Prepend(cat))
            .ToDictionary(cat => cat.Key);

    /// <summary>Every category key including subcategories.</summary>
    public static IEnumerable<TanahpediaCategory> All => _byKey.Values;

    /// <summary>Looks up a category or subcategory by key.</summary>
    public static TanahpediaCategory? Find(string? key) =>
        key is not null && _byKey.TryGetValue(key, out var cat) ? cat : null;

    /// <summary>Hebrew label for a category/entity-type key; the key itself when unknown.</summary>
    public static string LabelFor(string? key) => Find(key)?.Label ?? key ?? string.Empty;
}
