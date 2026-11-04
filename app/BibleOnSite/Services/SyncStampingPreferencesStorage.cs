using System.Text.Json;
using BibleOnSite.Models;

namespace BibleOnSite.Services;

/// <summary>
/// A write record for one preference key: when the local device last wrote it
/// and whether that write was a removal. Cloud preference sync compares these
/// stamps against the remote document's per-key update times to decide which
/// side wins each field (last-writer-wins, #1095).
/// </summary>
public sealed class PreferenceStamp
{
    public long UpdatedAtMs { get; set; }
    public bool Tombstone { get; set; }
}

/// <summary>
/// <see cref="IPreferencesStorage"/> decorator that records a timestamped write
/// stamp for every Set/Remove flowing through it. The stamp map is itself
/// persisted in the wrapped storage so merge ordering survives restarts.
/// Sync uses the stamps to tell "locally changed at time T" from "never
/// written"; keys never written locally contribute nothing and let the remote
/// document win (#1095).
/// </summary>
public sealed class SyncStampingPreferencesStorage : IPreferencesStorage
{
    /// <summary>Storage key holding the JSON-serialized stamp map. It is written
    /// through the inner storage directly, so it never stamps itself.</summary>
    internal const string StampsStorageKey = "cloudSyncStamps.v1";

    private readonly IPreferencesStorage _inner;
    private readonly Func<long> _nowUnixMs;
    private readonly object _gate = new();
    private readonly Dictionary<string, PreferenceStamp> _stamps;

    public SyncStampingPreferencesStorage(IPreferencesStorage inner) : this(inner, null) { }

    public SyncStampingPreferencesStorage(IPreferencesStorage inner, Func<long>? nowUnixMs)
    {
        _inner = inner ?? throw new ArgumentNullException(nameof(inner));
        _nowUnixMs = nowUnixMs ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        _stamps = LoadStamps(inner);
    }

    public T Get<T>(string key, T defaultValue) => _inner.Get(key, defaultValue);

    public void Set<T>(string key, T value)
    {
        _inner.Set(key, value);
        RecordStamp(key, tombstone: false);
    }

    public void Remove(string key)
    {
        _inner.Remove(key);
        RecordStamp(key, tombstone: true);
    }

    public bool ContainsKey(string key) => _inner.ContainsKey(key);

    /// <summary>Point-in-time copy of the recorded write stamps.</summary>
    public IReadOnlyDictionary<string, PreferenceStamp> GetStampsSnapshot()
    {
        lock (_gate)
        {
            return _stamps.ToDictionary(
                pair => pair.Key,
                pair => new PreferenceStamp { UpdatedAtMs = pair.Value.UpdatedAtMs, Tombstone = pair.Value.Tombstone });
        }
    }

    /// <summary>
    /// Forces the stamp for <paramref name="key"/> — used by cloud sync after
    /// applying a remote winner so the recorded stamp matches the winning
    /// side's update time instead of the local apply moment.
    /// </summary>
    public void OverrideStamp(string key, long updatedAtMs, bool tombstone)
    {
        WriteStamp(key, updatedAtMs, tombstone);
    }

    /// <summary>Stamps a pre-existing local key during first-sync migration
    /// (user-customized values keep winning against the remote document).</summary>
    public void StampAsNow(string key)
    {
        WriteStamp(key, _nowUnixMs(), tombstone: false);
    }

    private void RecordStamp(string key, bool tombstone)
    {
        WriteStamp(key, _nowUnixMs(), tombstone);
    }

    private void WriteStamp(string key, long updatedAtMs, bool tombstone)
    {
        lock (_gate)
        {
            _stamps[key] = new PreferenceStamp { UpdatedAtMs = updatedAtMs, Tombstone = tombstone };
            PersistStamps();
        }
    }

    private void PersistStamps()
    {
        var json = JsonSerializer.Serialize(_stamps, AppJsonContext.Default.PreferenceStamps);
        _inner.Set(StampsStorageKey, json);
    }

    private static Dictionary<string, PreferenceStamp> LoadStamps(IPreferencesStorage storage)
    {
        var json = storage.Get(StampsStorageKey, string.Empty);
        if (string.IsNullOrEmpty(json))
        {
            return new Dictionary<string, PreferenceStamp>();
        }
        try
        {
            return JsonSerializer.Deserialize(json, AppJsonContext.Default.PreferenceStamps)
                ?? new Dictionary<string, PreferenceStamp>();
        }
        catch (JsonException ex)
        {
            // Same contract as stored bookmarks: a corrupt value resets rather
            // than silently losing data — a fresh stamp map only re-syncs.
            Console.Error.WriteLine(
                $"Stored preference sync stamps reset — corrupt JSON ignored ({ex.Message})");
            return new Dictionary<string, PreferenceStamp>();
        }
    }
}
