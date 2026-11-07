using System.Text.Json;
using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Services;

/// <summary>
/// Synchronizes <see cref="PreferencesService"/> with a per-user cloud
/// document (#1095 — Firestore on Android/iOS, local-only elsewhere).
///
/// Semantics:
/// - Field-level last-writer-wins: each synced key carries a per-key update
///   timestamp (local write stamps come from
///   <see cref="SyncStampingPreferencesStorage"/>, remote stamps live in the
///   document). On equal stamps the remote wins — the remote document is
///   already converged, so no extra write is needed.
/// - Tombstones: removing a key (e.g. clearing the last-learnt perek) records
///   a tombstone so the delete wins by timestamp instead of resurrecting from
///   an older value on another device.
/// - First sync after upgrading: keys that exist in local storage but have no
///   stamp are stamped "now" — existing local preferences are preserved and
///   become the cloud truth (per the issue's triage decision).
/// - Unknown remote keys (written by a newer app version) pass through the
///   merge untouched — they are re-uploaded but never applied locally.
/// - Local writes trigger a debounced re-sync; sync failures keep local state
///   and retry on the next change/launch. Anonymous users never sync.
/// </summary>
public sealed class PreferencesSyncService : IDisposable
{
    private static PreferencesSyncService? _instance;
    private static readonly object _instanceLock = new();

    /// <summary>Gets the singleton. <see cref="Initialize"/> must run first.</summary>
    public static PreferencesSyncService Instance => _instance
        ?? throw new InvalidOperationException(
            "PreferencesSyncService not initialized. Call Initialize() first or use CreateForTesting().");

    public static void Initialize(
        SyncStampingPreferencesStorage storage,
        PreferencesService preferences,
        IPreferencesCloudStore cloudStore,
        IUserIdentity identity)
    {
        lock (_instanceLock)
        {
            _instance ??= new PreferencesSyncService(storage, preferences, cloudStore, identity, null, null);
        }
    }

    /// <summary>Creates a standalone instance for testing with injected clock/debounce.</summary>
    public static PreferencesSyncService CreateForTesting(
        SyncStampingPreferencesStorage storage,
        PreferencesService preferences,
        IPreferencesCloudStore cloudStore,
        IUserIdentity identity,
        TimeProvider? timeProvider,
        TimeSpan? pushDebounce)
    {
        return new PreferencesSyncService(
            storage, preferences, cloudStore, identity, timeProvider, pushDebounce);
    }

    /// <summary>Resets the singleton. Only for testing.</summary>
    internal static void ResetForTesting()
    {
        lock (_instanceLock)
        {
            _instance = null;
        }
    }

    internal const string DeviceIdStorageKey = "cloudSyncDeviceId";

    private sealed record SyncedPreference(Func<object?> Get, Action<object?> Apply);

    private sealed class MergeResult
    {
        public required PreferencesCloudDocument Document { get; init; }
        /// <summary>Synced keys whose remote entry won — applied to local preferences.</summary>
        public required List<string> RemoteWinnerKeys { get; init; }
        /// <summary>True when the merged document differs from the fetched one and must be pushed.</summary>
        public required bool ShouldWrite { get; set; }
    }

    private readonly SyncStampingPreferencesStorage _stampedStorage;
    private readonly PreferencesService _preferences;
    private readonly IPreferencesCloudStore _cloudStore;
    private readonly IUserIdentity _identity;
    private readonly TimeProvider _timeProvider;
    private readonly TimeSpan _pushDebounce;
    private readonly IReadOnlyDictionary<string, SyncedPreference> _synced;
    private readonly SemaphoreSlim _syncSemaphore = new(1, 1);
    private readonly object _gate = new();

    private CancellationTokenSource? _scheduledCts;
    private Task _pendingSync = Task.CompletedTask;
    private bool _started;
    private bool _migrationDone;
    private int _applyDepth;
    private string? _deviceId;
    private bool _disposed;

    private PreferencesSyncService(
        SyncStampingPreferencesStorage storage,
        PreferencesService preferences,
        IPreferencesCloudStore cloudStore,
        IUserIdentity identity,
        TimeProvider? timeProvider,
        TimeSpan? pushDebounce)
    {
        _stampedStorage = storage ?? throw new ArgumentNullException(nameof(storage));
        _preferences = preferences ?? throw new ArgumentNullException(nameof(preferences));
        _cloudStore = cloudStore ?? throw new ArgumentNullException(nameof(cloudStore));
        _identity = identity ?? throw new ArgumentNullException(nameof(identity));
        _timeProvider = timeProvider ?? TimeProvider.System;
        _pushDebounce = pushDebounce ?? TimeSpan.FromSeconds(2);
        _synced = BuildSyncedPreferences(preferences);
    }

    /// <summary>
    /// Subscribes to preference/auth changes, establishes identity (anonymous
    /// Firebase sign-in where supported) and runs the first merge. Call once
    /// after <see cref="PreferencesService.Load"/> so the merge sees the
    /// loaded local state. Safe to call again — later calls are ignored.
    /// </summary>
    public Task StartAsync() => StartAsync(CancellationToken.None);

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (_started || _disposed)
            {
                return;
            }
            _started = true;
        }
        _preferences.PreferencesChanged += OnPreferencesChanged;
        _identity.UserChanged += OnUserChanged;
        try
        {
            await _identity.EnsureSignedInAsync(cancellationToken);
        }
#pragma warning disable S2221 // Deliberate failure boundary: identity failure leaves the app local-only.
        catch (Exception ex) when (ex is not OperationCanceledException) //NOSONAR — identity failure leaves the app local-only.
        {
#pragma warning restore S2221
            Console.Error.WriteLine($"[PreferencesSync] sign-in failed — staying local ({ex.Message})");
        }
        await SyncNowAsync(cancellationToken);
    }

    /// <summary>Schedules an immediate merge+push; awaited by callers/tests via the returned task.</summary>
    public Task SyncNowAsync() => SyncNowAsync(CancellationToken.None);

    public Task SyncNowAsync(CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            _scheduledCts?.Cancel();
            var cts = _scheduledCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            return _pendingSync = RunSyncSafelyAsync(TimeSpan.Zero, cts);
        }
    }

    /// <summary>The currently scheduled sync — tests await this after triggering a local write.</summary>
    internal Task PendingSync
    {
        get
        {
            lock (_gate)
            {
                return _pendingSync;
            }
        }
    }

    private void OnPreferencesChanged(object? sender, EventArgs e)
    {
        // Applying remote winners raises this event through the setters; the
        // merged state is already converged so it must not re-schedule a push.
        if (_applyDepth > 0 || _disposed || !_started)
        {
            return;
        }
        ScheduleSync(_pushDebounce);
    }

    private void OnUserChanged(object? sender, EventArgs e) => ScheduleSync(TimeSpan.Zero);

    private void ScheduleSync(TimeSpan delay)
    {
        lock (_gate)
        {
            if (_disposed || !_started)
            {
                return;
            }
            _scheduledCts?.Cancel();
            var cts = _scheduledCts = new CancellationTokenSource();
            _pendingSync = RunSyncSafelyAsync(delay, cts);
        }
    }

    private async Task RunSyncSafelyAsync(TimeSpan delay, CancellationTokenSource cts)
    {
        // Disposed at scope exit — after the finally below detaches it from
        // _scheduledCts, so a racing Cancel cannot land on a disposed source.
        using var _ = cts;
        var cancellationToken = cts.Token;
        try
        {
            if (delay > TimeSpan.Zero)
            {
                await Task.Delay(delay, _timeProvider, cancellationToken);
            }
            await _syncSemaphore.WaitAsync(cancellationToken);
            try
            {
                await SyncCoreAsync(cancellationToken);
            }
            finally
            {
                _syncSemaphore.Release();
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer write — its own scheduled run will sync.
        }
#pragma warning disable S2221 // Deliberate failure boundary: sync failure keeps local state and retries on the next change.
        catch (Exception ex) //NOSONAR — sync failure keeps local state and retries on the next change.
        {
#pragma warning restore S2221
            Console.Error.WriteLine($"[PreferencesSync] sync failed — kept local preferences ({ex.Message})");
        }
        finally
        {
            lock (_gate)
            {
                // Clear only our own source — a newer schedule may already
                // have replaced it; canceling a disposed source would throw.
                if (ReferenceEquals(_scheduledCts, cts))
                {
                    _scheduledCts = null;
                }
            }
        }
    }

    private async Task SyncCoreAsync(CancellationToken cancellationToken)
    {
        if (_identity.UserId is not { } userId)
        {
            // Anonymous — local persistence is the whole story.
            return;
        }
        MigrateLocalStampsOnce();
        var remote = await _cloudStore.FetchAsync(userId, cancellationToken);
        if (remote != null && remote.Entries.Count > 0)
        {
            // Future-dated remote entries (a device with a fast clock) must not
            // win against edits made after they were observed — raise the
            // local stamp floor above every timestamp this fetch saw.
            _stampedStorage.RaiseStampFloor(remote.Entries.Values.Max(entry => entry.UpdatedAtMs) + 1);
        }
        var merge = ComputeMerge(remote);
        ApplyRemoteWinners(merge);
        if (merge.ShouldWrite)
        {
            await _cloudStore.SaveAsync(userId, merge.Document, cancellationToken);
        }
    }

    /// <summary>
    /// First sync after the feature ships: local keys written before sync
    /// existed have no stamp. The user customized them on this device, so
    /// they are stamped "now" and win the first merge — preserving existing
    /// local preferences per the issue's triage decision.
    /// </summary>
    private void MigrateLocalStampsOnce()
    {
        if (_migrationDone)
        {
            return;
        }
        _migrationDone = true;
        var stamps = _stampedStorage.GetStampsSnapshot();
        foreach (var key in _synced.Keys.Where(key => !stamps.ContainsKey(key) && _stampedStorage.ContainsKey(key)))
        {
            _stampedStorage.StampAsNow(key);
        }
    }

    private MergeResult ComputeMerge(PreferencesCloudDocument? remote)
    {
        var stamps = _stampedStorage.GetStampsSnapshot();
        var merged = new PreferencesCloudDocument { DeviceId = DeviceId };
        var remoteWinnerKeys = new List<string>();
        var anyLocalWinner = false;

        var keys = new HashSet<string>(stamps.Keys);
        if (remote != null)
        {
            keys.UnionWith(remote.Entries.Keys);
        }

        foreach (var key in keys)
        {
            stamps.TryGetValue(key, out var stamp);
            CloudPreferenceEntry? remoteEntry = null;
            remote?.Entries.TryGetValue(key, out remoteEntry);
            var synced = _synced.TryGetValue(key, out var syncedPreference) ? syncedPreference : null;

            var localEntry = BuildLocalEntry(stamp, synced);
            if (localEntry == null && remoteEntry == null)
            {
                continue;
            }
            // Remote wins when it exists and the local write is missing or
            // older; timestamp ties favor the already-converged remote doc.
            var remoteWon = remoteEntry != null
                && (localEntry == null || localEntry.UpdatedAtMs <= remoteEntry.UpdatedAtMs);
            var winner = (remoteWon ? remoteEntry : localEntry)!;

            merged.Entries[key] = winner;
            if (remoteWon)
            {
                // Only synced keys apply locally; unknown keys pass through.
                if (synced != null)
                {
                    remoteWinnerKeys.Add(key);
                }
            }
            else
            {
                anyLocalWinner = true;
            }
        }

        return new MergeResult
        {
            Document = merged,
            RemoteWinnerKeys = remoteWinnerKeys,
            ShouldWrite = remote == null
                || anyLocalWinner
                || remote.SchemaVersion != PreferencesCloudDocument.CurrentSchemaVersion,
        };
    }

    private CloudPreferenceEntry? BuildLocalEntry(PreferenceStamp? stamp, SyncedPreference? synced)
    {
        if (synced == null || stamp == null)
        {
            return null;
        }
        var value = synced.Get();
        if (stamp.Tombstone)
        {
            return new CloudPreferenceEntry
            {
                UpdatedAtMs = stamp.UpdatedAtMs,
                Tombstone = true,
                DeviceId = DeviceId,
            };
        }
        if (value == null)
        {
            // Stamped write but no current value — nothing to claim.
            return null;
        }
        return new CloudPreferenceEntry
        {
            Value = PreferencesCloudCodec.Canonicalize(value),
            UpdatedAtMs = stamp.UpdatedAtMs,
            DeviceId = DeviceId,
        };
    }

    private void ApplyRemoteWinners(MergeResult merge)
    {
        var rejectedKeys = new List<string>();
        try
        {
            _applyDepth++;
            foreach (var key in merge.RemoteWinnerKeys)
            {
                var entry = merge.Document.Entries[key];
                try
                {
                    _synced[key].Apply(entry.Tombstone ? null : entry.Value);
                }
#pragma warning disable S2221 // Deliberate failure boundary: one bad remote value must not block the rest of the merge.
                catch (Exception ex) //NOSONAR — one bad remote value must not block the rest of the merge.
                {
#pragma warning restore S2221
                    rejectedKeys.Add(key);
                    Console.Error.WriteLine($"[PreferencesSync] remote value for '{key}' ignored ({ex.Message})");
                }
            }
        }
        finally
        {
            _applyDepth--;
        }

        // The merge decided each key's stamp — record winners verbatim so the
        // next round compares against the remote truth, not the apply moment.
        // Rejected keys are skipped: claiming their stamp would make the
        // unapplied remote entry look converged and re-fail on every sync.
        var stamps = _stampedStorage.GetStampsSnapshot();
        foreach (var (key, entry) in merge.Document.Entries)
        {
            if (!_synced.ContainsKey(key) || rejectedKeys.Contains(key))
            {
                continue;
            }
            if (!stamps.TryGetValue(key, out var stamp)
                || stamp.UpdatedAtMs != entry.UpdatedAtMs
                || stamp.Tombstone != entry.Tombstone)
            {
                _stampedStorage.OverrideStamp(key, entry.UpdatedAtMs, entry.Tombstone);
            }
        }

        // Heal rejected entries: overwrite the remote value with the current
        // local one at the remote's own timestamp, so the saved document
        // holds parseable data instead of re-failing on every device.
        foreach (var key in rejectedKeys)
        {
            if (!merge.Document.Entries.TryGetValue(key, out var rejected) || rejected.Tombstone)
            {
                continue;
            }
            merge.Document.Entries[key] = new CloudPreferenceEntry
            {
                Value = PreferencesCloudCodec.Canonicalize(_synced[key].Get()),
                UpdatedAtMs = rejected.UpdatedAtMs,
                DeviceId = DeviceId,
            };
            merge.ShouldWrite = true;
        }
    }

    private string DeviceId => _deviceId ??= LoadOrCreateDeviceId();

    private string LoadOrCreateDeviceId()
    {
        var stored = _stampedStorage.Get(DeviceIdStorageKey, string.Empty);
        if (!string.IsNullOrEmpty(stored))
        {
            return stored;
        }
        var created = Guid.NewGuid().ToString("N");
        _stampedStorage.Set(DeviceIdStorageKey, created);
        return created;
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }
            _disposed = true;
            _scheduledCts?.Cancel();
        }
        _preferences.PreferencesChanged -= OnPreferencesChanged;
        _identity.UserChanged -= OnUserChanged;
    }

    /// <summary>
    /// The synced key allowlist: every PreferencesService-backed setting is
    /// cloud-synced EXCEPT <c>inAppBackButton</c>, which is explicitly an
    /// Android-only device override that must never leak across platforms.
    /// Values use the same canonical shapes the local storage layer writes.
    /// </summary>
    private static IReadOnlyDictionary<string, SyncedPreference> BuildSyncedPreferences(PreferencesService preferences)
    {
        return new Dictionary<string, SyncedPreference>
        {
            [PreferencesService.InlineCommentaryLimitKey] = new(
                () => preferences.InlineCommentaryLimit,
                v => preferences.InlineCommentaryLimit = PreferencesCloudCodec.AsInt(v, preferences.InlineCommentaryLimit)),
            [PreferencesService.FontFactorKey] = new(
                () => preferences.FontFactor,
                v => preferences.FontFactor = PreferencesCloudCodec.AsDouble(v, preferences.FontFactor)),
            [PreferencesService.PasukFontPercentKey] = new(
                () => preferences.PasukFontPercent,
                v => preferences.PasukFontPercent = PreferencesCloudCodec.AsDouble(v, preferences.PasukFontPercent)),
            [PreferencesService.PerushFontPercentKey] = new(
                () => preferences.PerushFontPercent,
                v => preferences.PerushFontPercent = PreferencesCloudCodec.AsDouble(v, preferences.PerushFontPercent)),
            [PreferencesService.ArticleFontPercentKey] = new(
                () => preferences.ArticleFontPercent,
                v => preferences.ArticleFontPercent = PreferencesCloudCodec.AsDouble(v, preferences.ArticleFontPercent)),
            [PreferencesService.LastLearntPerekKey] = new(
                () => preferences.LastLearntPerek,
                v =>
                {
                    if (v is null)
                    {
                        preferences.LastLearntPerek = null;
                    }
                    else
                    {
                        var parsed = PreferencesCloudCodec.AsInt(v, -1);
                        if (parsed >= 0)
                        {
                            preferences.LastLearntPerek = parsed;
                        }
                    }
                }),
            [PreferencesService.PerekToLoadKey] = new(
                () => (int)preferences.PerekToLoad,
                v =>
                {
                    var parsed = PreferencesCloudCodec.AsInt(v, -1);
                    if (Enum.IsDefined((PerekToLoad)parsed))
                    {
                        preferences.PerekToLoad = (PerekToLoad)parsed;
                    }
                }),
            [PreferencesService.BookmarkedPerakimKey] = new(
                () => SerializeBookmarks(preferences.BookmarkedPerakim),
                v => ApplyBookmarks(preferences, v)),
            [PreferencesService.MasoraMenuEnabledKey] = new(
                () => preferences.MasoraMenuEnabled,
                v => preferences.MasoraMenuEnabled = PreferencesCloudCodec.AsBool(v, preferences.MasoraMenuEnabled)),
            [PreferencesService.QriynotEnabledKey] = new(
                () => preferences.QriynotEnabled,
                v => preferences.QriynotEnabled = PreferencesCloudCodec.AsBool(v, preferences.QriynotEnabled)),
            [PreferencesService.DivineNameMaskingEnabledKey] = new(
                () => preferences.DivineNameMaskingEnabled,
                v => preferences.DivineNameMaskingEnabled = PreferencesCloudCodec.AsBool(v, preferences.DivineNameMaskingEnabled)),
            [PreferencesService.DivineNameMaskElohimKey] = new(
                () => PreferencesService.MaskOptionName(preferences.DivineNameMaskElohim),
                v => ApplyMaskOption(v, option => preferences.DivineNameMaskElohim = option)),
            [PreferencesService.DivineNameMaskElohimCustomKey] = new(
                () => preferences.DivineNameMaskElohimCustom,
                v => preferences.DivineNameMaskElohimCustom = v as string ?? preferences.DivineNameMaskElohimCustom),
            [PreferencesService.DivineNameMaskYhwhKey] = new(
                () => PreferencesService.MaskOptionName(preferences.DivineNameMaskYhwh),
                v => ApplyMaskOption(v, option => preferences.DivineNameMaskYhwh = option)),
            [PreferencesService.DivineNameMaskYhwhCustomKey] = new(
                () => preferences.DivineNameMaskYhwhCustom,
                v => preferences.DivineNameMaskYhwhCustom = v as string ?? preferences.DivineNameMaskYhwhCustom),
            [PreferencesService.DivineNameMaskElKey] = new(
                () => PreferencesService.MaskOptionName(preferences.DivineNameMaskEl),
                v => ApplyMaskOption(v, option => preferences.DivineNameMaskEl = option)),
            [PreferencesService.DivineNameMaskShaddaiKey] = new(
                () => PreferencesService.MaskOptionName(preferences.DivineNameMaskShaddai),
                v => ApplyMaskOption(v, option => preferences.DivineNameMaskShaddai = option)),
            [PreferencesService.DivineNameMaskShaddaiCustomKey] = new(
                () => preferences.DivineNameMaskShaddaiCustom,
                v => preferences.DivineNameMaskShaddaiCustom = v as string ?? preferences.DivineNameMaskShaddaiCustom),
            [PreferencesService.RecitationSpeedKey] = new(
                () => preferences.RecitationSpeed,
                v => preferences.RecitationSpeed = PreferencesCloudCodec.AsDouble(v, preferences.RecitationSpeed)),
            [PreferencesService.RecitationVolumeKey] = new(
                () => preferences.RecitationVolume,
                v => preferences.RecitationVolume = PreferencesCloudCodec.AsDouble(v, preferences.RecitationVolume)),
            [PreferencesService.LessonsVolumeKey] = new(
                () => preferences.LessonsVolume,
                v => preferences.LessonsVolume = PreferencesCloudCodec.AsDouble(v, preferences.LessonsVolume)),
            [PreferencesService.EffectsVolumeKey] = new(
                () => preferences.EffectsVolume,
                v => preferences.EffectsVolume = PreferencesCloudCodec.AsDouble(v, preferences.EffectsVolume)),
            [PreferencesService.RecitationVersePauseMsKey] = new(
                () => preferences.RecitationVersePauseMs,
                v => preferences.RecitationVersePauseMs = PreferencesCloudCodec.AsDouble(v, preferences.RecitationVersePauseMs)),
        };
    }

    private static void ApplyMaskOption(object? value, Action<DivineNameMaskOption> apply)
    {
        if (value is string name
            && PreferencesService.MaskOptionNames.TryGetValue(name, out var option))
        {
            apply(option);
        }
    }

    private static string SerializeBookmarks(IReadOnlySet<int> perekIds) =>
        JsonSerializer.Serialize(perekIds.OrderBy(id => id).ToArray(), AppJsonContext.Default.BookmarkedPerakim);

    private static void ApplyBookmarks(PreferencesService preferences, object? value)
    {
        if (value is not string json || string.IsNullOrWhiteSpace(json))
        {
            return;
        }
        var ids = JsonSerializer.Deserialize(json, AppJsonContext.Default.BookmarkedPerakim);
        if (ids != null)
        {
            preferences.ReplaceBookmarks(ids);
        }
    }
}
