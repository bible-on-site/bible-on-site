using System.Collections;

namespace BibleOnSite.Services;

/// <summary>
/// One synced preference value as stored in the remote document: the value
/// itself plus the write metadata merge needs. A tombstone entry carries no
/// value — it records "the user removed this key at <see cref="UpdatedAtMs"/>"
/// so a delete on one device stays deleted on every device (#1095).
/// </summary>
public sealed class CloudPreferenceEntry
{
    /// <summary>Canonical value — bool, long, double or string. Null iff tombstone.</summary>
    public object? Value { get; set; }
    public long UpdatedAtMs { get; set; }
    public bool Tombstone { get; set; }
    /// <summary>Diagnostics: which device wrote this entry.</summary>
    public string? DeviceId { get; set; }
}

/// <summary>
/// The remote preferences document for one user (Firestore path
/// <c>users/{uid}</c>). <see cref="Entries"/> holds every key the merge
/// produced — including keys this app version does not know, which pass
/// through untouched so a newer build's fields are never dropped (#1095).
/// </summary>
public sealed class PreferencesCloudDocument
{
    public static int CurrentSchemaVersion => 1;

    public int SchemaVersion { get; set; } = CurrentSchemaVersion;
    /// <summary>Last writer of the whole document (diagnostics).</summary>
    public string? DeviceId { get; set; }
    public Dictionary<string, CloudPreferenceEntry> Entries { get; } = new();
}

/// <summary>
/// Converts <see cref="PreferencesCloudDocument"/> to and from the plain
/// dictionary shape Firestore stores. Lenient on read — malformed entries are
/// skipped rather than failing the whole sync round.
/// </summary>
public static class PreferencesCloudCodec
{
    private const string SchemaVersionField = "schemaVersion";
    private const string DeviceIdField = "deviceId";
    private const string EntriesField = "entries";
    private const string ValueField = "value";
    private const string UpdatedAtField = "updatedAt";
    private const string TombstoneField = "tombstone";

    public static Dictionary<object, object?> ToFirestoreMap(PreferencesCloudDocument document)
    {
        var entries = new Dictionary<object, object?>();
        foreach (var (key, entry) in document.Entries)
        {
            var map = new Dictionary<object, object?>
            {
                [UpdatedAtField] = entry.UpdatedAtMs,
            };
            if (entry.Tombstone)
            {
                map[TombstoneField] = true;
            }
            else
            {
                map[ValueField] = entry.Value;
            }
            if (!string.IsNullOrEmpty(entry.DeviceId))
            {
                map[DeviceIdField] = entry.DeviceId;
            }
            entries[key] = map;
        }

        return new Dictionary<object, object?>
        {
            [SchemaVersionField] = (long)document.SchemaVersion,
            [DeviceIdField] = document.DeviceId,
            [EntriesField] = entries,
        };
    }

    /// <summary>
    /// Parses a Firestore document body. Returns null when the snapshot is
    /// empty; unknown fields and malformed entries are ignored so the doc
    /// stays forward/backward compatible.
    /// </summary>
    public static PreferencesCloudDocument? FromFirestoreMap(IDictionary? map)
    {
        if (map == null)
        {
            return null;
        }
        var document = new PreferencesCloudDocument
        {
            SchemaVersion = AsInt(Read(map, SchemaVersionField), PreferencesCloudDocument.CurrentSchemaVersion),
            DeviceId = Read(map, DeviceIdField) as string,
        };
        if (Read(map, EntriesField) is not IDictionary entries)
        {
            return document;
        }
        foreach (DictionaryEntry pair in entries)
        {
            if (pair.Key is not string key || pair.Value is not IDictionary entryMap)
            {
                continue;
            }
            var updatedAt = AsLong(Read(entryMap, UpdatedAtField), -1);
            if (updatedAt < 0)
            {
                // No update time — nothing to order by; drop the entry.
                continue;
            }
            var tombstone = Read(entryMap, TombstoneField) as bool? ?? false;
            var value = Read(entryMap, ValueField);
            if (!tombstone && !IsCanonicalValue(value))
            {
                continue;
            }
            document.Entries[key] = new CloudPreferenceEntry
            {
                Value = tombstone ? null : Canonicalize(value),
                UpdatedAtMs = updatedAt,
                Tombstone = tombstone,
                DeviceId = Read(entryMap, DeviceIdField) as string,
            };
        }
        return document;
    }

    private static object? Read(IDictionary map, string key) =>
        map.Contains(key) ? map[key] : null;

    private static bool IsCanonicalValue(object? value) =>
        value is null or bool or string or byte or sbyte or short or ushort or int or uint or long or ulong or float or double;

    /// <summary>Stores whole numbers as long — the single integer shape
    /// Firestore (and the app-side coercion helpers) round-trips.</summary>
    internal static object? Canonicalize(object? value) => value switch
    {
        null => null,
        bool or string => value,
        float or double => Convert.ToDouble(value),
        _ => Convert.ToInt64(value),
    };

    internal static int AsInt(object? value, int fallback) =>
        value is null ? fallback : Convert.ToInt32(value);

    internal static long AsLong(object? value, long fallback) =>
        value is null ? fallback : Convert.ToInt64(value);

    internal static double AsDouble(object? value, double fallback) =>
        value is null ? fallback : Convert.ToDouble(value);

    internal static bool AsBool(object? value, bool fallback) =>
        value is bool b ? b : fallback;
}
