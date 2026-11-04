using System.Text.Json;
using System.Text.Json.Serialization;

namespace BibleOnSite.Services;

/// <summary>
/// Mapping between extension-pack names and their Microsoft Store durable
/// add-on products, bundled as the <c>windows-extension-packs.json</c> asset.
///
/// Partner Center assigns each durable add-on a StoreId when the add-on is
/// created; until a pack has an entry here the delivery service skips the
/// Store install leg for it and serves the release-payload HTTPS fallback.
/// <see cref="PadDeliveryService"/> reads this only on Windows, where the
/// asset is packaged — other platforms never parse the file.
/// </summary>
public sealed partial class WindowsExtensionPackMap
{
    /// <summary>Bundled-asset logical name (see BibleOnSite.csproj).</summary>
    public static string FileName => "windows-extension-packs.json";

    private readonly IReadOnlyDictionary<string, Entry> _addOns;

    private WindowsExtensionPackMap(IReadOnlyDictionary<string, Entry> addOns)
    {
        _addOns = addOns;
    }

    /// <summary>An add-on configured with no StoreId is simply not store-deliverable.</summary>
    public string? StoreIdFor(string packName) =>
        _addOns.TryGetValue(packName, out var entry) && entry.StoreId.Length > 0
            ? entry.StoreId
            : null;

    /// <summary>
    /// The optional package identity name a Store add-on for this pack carries.
    /// Defaults to the related-set convention — the main package name suffixed
    /// with the pack name — so the generator and the runtime agree without a
    /// per-pack configuration entry.
    /// </summary>
    public string PackageNameFor(string mainPackageName, string packName) =>
        _addOns.TryGetValue(packName, out var entry) && entry.PackageName.Length > 0
            ? entry.PackageName
            : OptionalPackageName(mainPackageName, packName);

    /// <summary>
    /// Related-set naming convention shared by packager and runtime. Appx
    /// identity names accept only letters, digits, '.' and '-' — pack names
    /// with underscores (recitation_1, perushim_notes) are hyphenated the same
    /// way the iOS asset-pack IDs are.
    /// </summary>
    public static string OptionalPackageName(string mainPackageName, string packName) =>
        $"{mainPackageName}.{packName.Replace('_', '-')}";

    /// <summary>
    /// Parses the bundled map. A missing or empty file yields an empty map —
    /// packs still deliver through the release-payload fallback.
    /// </summary>
    public static WindowsExtensionPackMap Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return new WindowsExtensionPackMap(new Dictionary<string, Entry>());
        }

        var root = JsonSerializer.Deserialize<Root>(json, JsonContext.Default.Root)
            ?? throw new InvalidDataException("Empty extension-pack map.");
        if (root.Version != 1)
        {
            throw new InvalidDataException($"Unsupported extension-pack map version {root.Version}.");
        }

        var addOns = new Dictionary<string, Entry>(StringComparer.Ordinal);
        foreach (var (packName, entry) in root.AddOns ?? new Dictionary<string, Entry>())
        {
            if (string.IsNullOrWhiteSpace(packName))
            {
                throw new InvalidDataException("Extension-pack map contains an unnamed add-on.");
            }
            if (!IsValidPackId(packName))
            {
                throw new InvalidDataException($"Invalid extension-pack name '{packName}'.");
            }
            if (entry == null)
            {
                throw new InvalidDataException($"Extension-pack map has a null entry for '{packName}'.");
            }
            if (entry.StoreId.Length > 0 && !entry.StoreId.All(char.IsLetterOrDigit))
            {
                throw new InvalidDataException($"Invalid StoreId for '{packName}'.");
            }
            if (entry.PackageName.Length > 0 && !IsValidPackageName(entry.PackageName))
            {
                throw new InvalidDataException($"Invalid package name '{entry.PackageName}' for '{packName}'.");
            }
            addOns[packName] = entry;
        }
        return new WindowsExtensionPackMap(addOns);
    }

    private static bool IsValidPackId(string packName) =>
        packName.Length <= 64 && packName.All(c => char.IsLetterOrDigit(c) || c is '_' or '-');

    // Appx Identity names are 3–50 chars of letters, digits, '.' and '-'
    // (the [-.A-Za-z0-9]+ pattern makeappx enforces — no underscores).
    private static bool IsValidPackageName(string name) =>
        name.Length is >= 3 and <= 50 && name.All(c => char.IsLetterOrDigit(c) || c is '.' or '-');

    private sealed class Root
    {
        [JsonPropertyName("version")]
        public int Version { get; set; }

        [JsonPropertyName("addOns")]
        public Dictionary<string, Entry>? AddOns { get; set; }
    }

    private sealed class Entry
    {
        [JsonPropertyName("storeId")]
        public string StoreId { get; set; } = "";

        [JsonPropertyName("packageName")]
        public string PackageName { get; set; } = "";
    }

    // Native release builds trim reflection metadata; keep the wire format explicit.
    // Comments are tolerated so the bundled asset can document its own schema.
    [JsonSourceGenerationOptions(
        PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
        ReadCommentHandling = JsonCommentHandling.Skip)]
    [JsonSerializable(typeof(Root))]
    private partial class JsonContext : JsonSerializerContext;
}
