using System.Text.Json;

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
public sealed class WindowsExtensionPackMap
{
    /// <summary>Bundled-asset logical name (see BibleOnSite.csproj).</summary>
    public static string FileName => "windows-extension-packs.json";

    // The checked-in map is tiny and parsed once per process; comments are
    // tolerated so the bundled asset can document its own schema. Reflection
    // serialization is disabled app-wide, so parse the document directly —
    // the same approach WindowsExtensionPack.LoadPackageNameOverrides takes
    // in the packaging pipeline.
    private static readonly JsonDocumentOptions DocumentOptions = new()
    {
        CommentHandling = JsonCommentHandling.Skip,
    };

    private readonly IReadOnlyDictionary<string, Entry> _addOns;

    /// <summary>
    /// Parses the bundled map document. A missing or empty document yields an
    /// empty map — packs still deliver through the release-payload fallback.
    /// </summary>
    public WindowsExtensionPackMap(string? json)
    {
        _addOns = ParseAddOns(json);
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

    private static IReadOnlyDictionary<string, Entry> ParseAddOns(string? json)
    {
        var addOns = new Dictionary<string, Entry>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(json))
        {
            return addOns;
        }

        using var document = JsonDocument.Parse(json, DocumentOptions);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty("version", out var version) ||
            version.ValueKind != JsonValueKind.Number ||
            version.GetInt32() != 1)
        {
            throw new InvalidDataException("Unsupported extension-pack map version.");
        }
        if (!root.TryGetProperty("addOns", out var addOnsElement) ||
            addOnsElement.ValueKind != JsonValueKind.Object)
        {
            return addOns;
        }

        foreach (var addOn in addOnsElement.EnumerateObject())
        {
            var packName = addOn.Name;
            if (string.IsNullOrWhiteSpace(packName))
            {
                throw new InvalidDataException("Extension-pack map contains an unnamed add-on.");
            }
            if (!IsValidPackId(packName))
            {
                throw new InvalidDataException($"Invalid extension-pack name '{packName}'.");
            }
            if (addOn.Value.ValueKind != JsonValueKind.Object)
            {
                throw new InvalidDataException($"Extension-pack map has a null entry for '{packName}'.");
            }
            var storeId = StringProperty(addOn.Value, "storeId");
            var packageName = StringProperty(addOn.Value, "packageName");
            if (storeId.Length > 0 && !storeId.All(char.IsLetterOrDigit))
            {
                throw new InvalidDataException($"Invalid StoreId for '{packName}'.");
            }
            if (packageName.Length > 0 && !IsValidPackageName(packageName))
            {
                throw new InvalidDataException($"Invalid package name '{packageName}' for '{packName}'.");
            }
            addOns[packName] = new Entry(storeId, packageName);
        }
        return addOns;
    }

    private static string StringProperty(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";

    private static bool IsValidPackId(string packName) =>
        packName.Length <= 64 && packName.All(c => char.IsLetterOrDigit(c) || c is '_' or '-');

    // Appx Identity names are 3–50 chars of letters, digits, '.' and '-'
    // (the [-.A-Za-z0-9]+ pattern makeappx enforces — no underscores).
    private static bool IsValidPackageName(string name) =>
        name.Length is >= 3 and <= 50 && name.All(c => char.IsLetterOrDigit(c) || c is '.' or '-');

    private sealed record Entry(string StoreId, string PackageName);
}
