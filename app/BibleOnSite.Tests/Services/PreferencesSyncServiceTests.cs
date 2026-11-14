using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using FluentAssertions;
using Xunit;

namespace BibleOnSite.Tests.Services;

[Collection(PreferencesServiceCollection.Name)]
public class PreferencesSyncServiceTests : IDisposable
{
    private sealed class FakeIdentity : IUserIdentity
    {
        private EventHandler? _userChanged;

        public string? UserId { get; private set; }
        public int EnsureCalls { get; private set; }
        public Exception? EnsureError { get; set; }

        public event EventHandler? UserChanged
        {
            add => _userChanged += value;
            remove => _userChanged -= value;
        }

        public Task EnsureSignedInAsync(CancellationToken cancellationToken = default)
        {
            EnsureCalls++;
            cancellationToken.ThrowIfCancellationRequested();
            if (EnsureError != null)
            {
                throw EnsureError;
            }
            return Task.CompletedTask;
        }

        public void SignIn(string userId)
        {
            UserId = userId;
            _userChanged?.Invoke(this, EventArgs.Empty);
        }

        public void SignOut()
        {
            UserId = null;
            _userChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    private sealed class FakeCloudStore : IPreferencesCloudStore
    {
        public PreferencesCloudDocument? Document { get; private set; }
        public string? LastUserId { get; private set; }
        public int FetchCount { get; private set; }
        public int SaveCount { get; private set; }
        public Exception? FetchError { get; set; }

        public Task<PreferencesCloudDocument?> FetchAsync(string userId, CancellationToken cancellationToken = default)
        {
            FetchCount++;
            LastUserId = userId;
            cancellationToken.ThrowIfCancellationRequested();
            if (FetchError != null)
            {
                throw FetchError;
            }
            return Task.FromResult(Document);
        }

        public Task SaveAsync(string userId, PreferencesCloudDocument document, CancellationToken cancellationToken = default)
        {
            SaveCount++;
            LastUserId = userId;
            cancellationToken.ThrowIfCancellationRequested();
            Document = document;
            return Task.CompletedTask;
        }
    }

    private long _now = 10_000;
    private readonly InMemoryPreferencesStorage _inner = new();
    private readonly SyncStampingPreferencesStorage _storage;
    private readonly PreferencesService _preferences;
    private readonly FakeCloudStore _store = new();
    private readonly FakeIdentity _identity = new();
    private readonly PreferencesSyncService _sync;

    public PreferencesSyncServiceTests()
    {
        _storage = new SyncStampingPreferencesStorage(_inner, () => _now);
        _preferences = PreferencesService.CreateForTesting(_storage);
        _sync = PreferencesSyncService.CreateForTesting(
            _storage, _preferences, _store, _identity,
            timeProvider: null, pushDebounce: TimeSpan.Zero);
    }

    public void Dispose()
    {
        _sync.Dispose();
        // Load()/apply publishes ambient masking options — restore disabled so
        // no state leaks into other suites sharing this collection.
        DivineNameMasking.Apply(DivineNameMaskingOptions.Disabled);
    }

    private PreferencesCloudDocument RemoteDoc(params (string Key, object? Value, long Ts)[] entries)
    {
        var doc = new PreferencesCloudDocument { DeviceId = "other-device" };
        foreach (var (key, value, ts) in entries)
        {
            doc.Entries[key] = new CloudPreferenceEntry { Value = value, UpdatedAtMs = ts };
        }
        return doc;
    }

    private Task SeedRemoteAsync(PreferencesCloudDocument document) =>
        _store.SaveAsync("u1", document);

    private async Task StartSignedInAsync()
    {
        _identity.SignIn("u1");
        await _sync.StartAsync();
    }

    [Fact]
    public async Task Anonymous_NeverTouchesTheStore()
    {
        await _sync.StartAsync();

        _preferences.FontFactor = 1.9;
        await _sync.PendingSync;

        _store.FetchCount.Should().Be(0);
        _store.SaveCount.Should().Be(0);
    }

    [Fact]
    public async Task FirstSync_PushesStampedLocalEntries_WhenRemoteMissing()
    {
        _preferences.Load();
        _preferences.FontFactor = 1.5;

        await StartSignedInAsync();

        _store.SaveCount.Should().BeGreaterThanOrEqualTo(1);
        var doc = _store.Document!;
        doc.DeviceId.Should().NotBeNullOrEmpty();
        doc.Entries["fontFactor"].Value.Should().Be(1.5);
        doc.Entries["fontFactor"].UpdatedAtMs.Should().Be(_now);
    }

    [Fact]
    public async Task RemoteNewer_AppliesToPreferences_AndRecordsRemoteStamp()
    {
        _preferences.Load();
        _preferences.FontFactor = 1.5; // stamped 10000
        await SeedRemoteAsync(RemoteDoc(("fontFactor", 2.0, 20_000)));

        await StartSignedInAsync();

        _preferences.FontFactor.Should().Be(2.0);
        _inner.Get("fontFactor", 0.0).Should().Be(2.0);
        _storage.GetStampsSnapshot()["fontFactor"].UpdatedAtMs.Should().Be(20_000);
        // Remote won every key — merged doc equals remote, nothing to push.
        _store.SaveCount.Should().Be(1); // only the seed
    }

    [Fact]
    public async Task LocalNewer_PushesLocalValue()
    {
        _preferences.Load();
        _preferences.FontFactor = 1.5; // stamped 10000
        await SeedRemoteAsync(RemoteDoc(("fontFactor", 2.0, 5_000)));

        await StartSignedInAsync();

        _preferences.FontFactor.Should().Be(1.5);
        _store.Document!.Entries["fontFactor"].Value.Should().Be(1.5);
        _store.Document.Entries["fontFactor"].UpdatedAtMs.Should().Be(10_000);
    }

    [Fact]
    public async Task Migration_PreservesPreSyncLocalCustomizations()
    {
        // Values written before sync existed: present in storage, no stamp.
        _inner.Set("fontFactor", 1.7);
        _preferences.Load();
        await SeedRemoteAsync(RemoteDoc(
            ("fontFactor", 0.5, 5_000),       // older remote claim — local must win
            ("masoraMenuEnabled", true, 5_000))); // never set locally — remote wins

        await StartSignedInAsync();

        _preferences.FontFactor.Should().Be(1.7);
        _store.Document!.Entries["fontFactor"].Value.Should().Be(1.7);
        _preferences.MasoraMenuEnabled.Should().BeTrue();
    }

    [Fact]
    public async Task Migration_DoesNotStampKeysThatWereNeverWritten()
    {
        _preferences.Load(); // clean storage — nothing customized
        await SeedRemoteAsync(RemoteDoc(("fontFactor", 1.9, 5_000)));

        await StartSignedInAsync();

        _preferences.FontFactor.Should().Be(1.9);
        _storage.GetStampsSnapshot()["fontFactor"].UpdatedAtMs.Should().Be(5_000);
    }

    [Fact]
    public async Task RemoteTombstone_RemovesLocalValue_AndKeepsDelete()
    {
        _preferences.Load();
        _preferences.LastLearntPerek = 3; // stamped 10000
        var doc = RemoteDoc();
        doc.Entries["lastLearntPerek"] = new CloudPreferenceEntry { Tombstone = true, UpdatedAtMs = 20_000 };
        await SeedRemoteAsync(doc);

        await StartSignedInAsync();

        _preferences.LastLearntPerek.Should().BeNull();
        _inner.ContainsKey("lastLearntPerek").Should().BeFalse();
        _storage.GetStampsSnapshot()["lastLearntPerek"].Tombstone.Should().BeTrue();
        _storage.GetStampsSnapshot()["lastLearntPerek"].UpdatedAtMs.Should().Be(20_000);
    }

    [Fact]
    public async Task LocalTombstone_BeatsOlderRemoteValue()
    {
        _preferences.Load();
        _preferences.LastLearntPerek = 3;
        _now = 30_000;
        _preferences.LastLearntPerek = null; // tombstone @30000
        await SeedRemoteAsync(RemoteDoc(("lastLearntPerek", 7L, 20_000)));

        await StartSignedInAsync();

        _preferences.LastLearntPerek.Should().BeNull();
        _store.Document!.Entries["lastLearntPerek"].Tombstone.Should().BeTrue();
        _store.Document.Entries["lastLearntPerek"].UpdatedAtMs.Should().Be(30_000);
    }

    [Fact]
    public async Task RejectedRemoteValue_IsHealedWithLocalValue_AndNeverClaimsStamp()
    {
        _preferences.Load(); // fontFactor stays at its 1.0 default, unstamped
        await SeedRemoteAsync(RemoteDoc(("fontFactor", "not-a-number", 5_000)));

        await StartSignedInAsync();

        // The unparseable remote value is ignored locally and healed remotely:
        // the saved entry carries the current local value at the remote's own
        // timestamp, so no device re-fails on it.
        _preferences.FontFactor.Should().Be(1.0);
        var healed = _store.Document!.Entries["fontFactor"];
        healed.Value.Should().Be(1.0);
        healed.UpdatedAtMs.Should().Be(5_000);
        _storage.GetStampsSnapshot().Should().NotContainKey("fontFactor");

        // Converged: the healed document applies cleanly, no further write.
        var saves = _store.SaveCount;
        await _sync.SyncNowAsync();
        _store.SaveCount.Should().Be(saves);
    }

    [Fact]
    public async Task FutureDatedRemoteEntry_DoesNotBlockLaterLocalEdits()
    {
        _preferences.Load();
        // A device with a fast clock stamped this entry far in the future.
        await SeedRemoteAsync(RemoteDoc(("fontFactor", 2.0, _now + 1_000_000)));

        await StartSignedInAsync();
        _preferences.FontFactor.Should().Be(2.0);

        // The local edit happens after the remote entry was observed — the
        // stamp floor keeps it winning despite the skewed remote clock.
        _preferences.FontFactor = 1.7;
        await _sync.PendingSync;

        _preferences.FontFactor.Should().Be(1.7);
        _store.Document!.Entries["fontFactor"].Value.Should().Be(1.7);
        _store.Document.Entries["fontFactor"].UpdatedAtMs.Should().Be(_now + 1_000_000 + 1);
    }

    [Fact]
    public async Task UnknownRemoteKeys_PassThroughUnchanged_AndAreNotApplied()
    {
        _preferences.Load();
        await SeedRemoteAsync(RemoteDoc(("futureSetting", "from-newer-app", 99_999)));

        await StartSignedInAsync();

        _inner.ContainsKey("futureSetting").Should().BeFalse();
        _store.Document!.Entries["futureSetting"].Value.Should().Be("from-newer-app");
    }

    [Fact]
    public async Task LocalWrite_AfterStart_PushesMergedDocument()
    {
        _preferences.Load();
        await StartSignedInAsync();
        var savesAfterStart = _store.SaveCount;

        _now = 40_000;
        _preferences.FontFactor = 1.9;
        await _sync.PendingSync;

        _store.SaveCount.Should().Be(savesAfterStart + 1);
        _store.Document!.Entries["fontFactor"].Value.Should().Be(1.9);
    }

    [Fact]
    public async Task FetchFailure_KeepsLocal_AndDoesNotThrow()
    {
        _preferences.Load();
        _preferences.FontFactor = 1.5;
        _identity.SignIn("u1");
        _store.FetchError = new InvalidOperationException("offline");

        var act = () => _sync.StartAsync();

        await act.Should().NotThrowAsync();
        _preferences.FontFactor.Should().Be(1.5);
        _store.SaveCount.Should().Be(0);
    }

    [Fact]
    public async Task ApplyingRemoteWinners_DoesNotScheduleAnEchoSync()
    {
        _preferences.Load();
        await SeedRemoteAsync(RemoteDoc(("fontFactor", 2.0, 20_000)));

        await StartSignedInAsync();
        var completedSync = _sync.PendingSync;

        _sync.PendingSync.Should().BeSameAs(completedSync);
        _store.FetchCount.Should().Be(1);
    }

    [Fact]
    public async Task SignIn_TriggersSync()
    {
        _preferences.Load();
        await _sync.StartAsync(); // anonymous
        _preferences.FontFactor = 1.6;
        await _sync.PendingSync;
        _store.FetchCount.Should().Be(0);

        _identity.SignIn("u9");
        await _sync.PendingSync;

        _store.FetchCount.Should().Be(1);
        _store.Document!.Entries["fontFactor"].Value.Should().Be(1.6);
    }

    [Fact]
    public async Task SignOut_StopsPushes()
    {
        _preferences.Load();
        await StartSignedInAsync();
        var fetches = _store.FetchCount;

        _identity.SignOut();
        await _sync.PendingSync;
        _preferences.FontFactor = 1.4;
        await _sync.PendingSync;

        _store.FetchCount.Should().Be(fetches);
    }

    [Fact]
    public async Task ConvergedSecondSync_DoesNotRewrite()
    {
        _preferences.Load();
        _preferences.FontFactor = 1.5;
        await StartSignedInAsync();
        var saves = _store.SaveCount;

        await _sync.SyncNowAsync();

        _store.SaveCount.Should().Be(saves);
    }

    [Fact]
    public async Task RemoteBookmarks_ReplaceLocalSet()
    {
        _preferences.Load();
        _preferences.AddBookmark(9);
        await SeedRemoteAsync(RemoteDoc(("bookmarkedPerakim", "[1,2,3]", 20_000)));

        await StartSignedInAsync();

        _preferences.BookmarkedPerakim.Should().BeEquivalentTo([1, 2, 3]);
        _inner.Get("bookmarkedPerakim", "").Should().Contain("1");
    }

    [Fact]
    public async Task RemoteMaskOption_AppliesThroughEnumSetters()
    {
        _preferences.Load();
        await SeedRemoteAsync(RemoteDoc(("divineNameMaskElohim", "elokim", 20_000)));

        await StartSignedInAsync();

        _preferences.DivineNameMaskElohim.Should().Be(DivineNameMaskOption.Elokim);
    }

    [Fact]
    public async Task DeviceOnlyPreference_NeverReachesTheCloud()
    {
        _preferences.Load();
        _preferences.InAppBackButton = InAppBackButtonPreference.Show; // stamped, not synced
        _preferences.FontFactor = 1.5;

        await StartSignedInAsync();

        _store.Document!.Entries.Should().NotContainKey("inAppBackButton");
    }

    [Fact]
    public async Task RemoteValue_Applies_WhenLocalNeverWroteTheKey()
    {
        _preferences.Load();
        await SeedRemoteAsync(RemoteDoc(("lastLearntPerek", 5L, 5_000)));

        await StartSignedInAsync();

        _preferences.LastLearntPerek.Should().Be(5);
    }

    [Fact]
    public async Task InvalidRemoteValue_IsIgnored_OtherKeysStillApply()
    {
        _preferences.Load();
        var doc = RemoteDoc(
            ("perekToLoad", 9L, 20_000),   // out of enum range — ignored
            ("fontFactor", 1.8, 20_000));  // valid — applied
        await SeedRemoteAsync(doc);

        await StartSignedInAsync();

        _preferences.PerekToLoad.Should().Be(PerekToLoad.Todays);
        _preferences.FontFactor.Should().Be(1.8);
    }

    [Fact]
    public async Task StartAsync_IsIdempotent()
    {
        _preferences.Load();
        await StartSignedInAsync();
        await _sync.StartAsync();

        _store.FetchCount.Should().Be(1);
    }

    [Fact]
    public async Task DebouncedPush_StillDeliversAfterTheDelay()
    {
        var sync = PreferencesSyncService.CreateForTesting(
            _storage, _preferences, _store, _identity,
            timeProvider: null, pushDebounce: TimeSpan.FromMilliseconds(30));
        _preferences.Load();
        _identity.SignIn("u1");
        await sync.StartAsync();
        var savesAfterStart = _store.SaveCount;

        _preferences.FontFactor = 1.4;
        await sync.PendingSync;

        _store.SaveCount.Should().Be(savesAfterStart + 1);
        _store.Document!.Entries["fontFactor"].Value.Should().Be(1.4);
        sync.Dispose();
    }

    [Fact]
    public async Task DisposedSync_IgnoresLaterEvents()
    {
        _preferences.Load();
        await StartSignedInAsync();
        var fetches = _store.FetchCount;

        _sync.Dispose();
        _identity.SignIn("u2");
        _preferences.FontFactor = 1.3;
        await _sync.PendingSync;

        _store.FetchCount.Should().Be(fetches);
    }

    [Fact]
    public void Singleton_Initialize_ExposesInstance_UntilReset()
    {
        PreferencesSyncService.ResetForTesting();
        try
        {
            Action read = () => _ = PreferencesSyncService.Instance;
            read.Should().Throw<InvalidOperationException>();

            PreferencesSyncService.Initialize(_storage, _preferences, _store, _identity);

            var first = PreferencesSyncService.Instance;
            first.Should().NotBeNull();
            // A second Initialize is ignored — the singleton is created once.
            PreferencesSyncService.Initialize(_storage, _preferences, _store, _identity);
            PreferencesSyncService.Instance.Should().BeSameAs(first);
        }
        finally
        {
            PreferencesSyncService.ResetForTesting();
        }

        Action readAfterReset = () => _ = PreferencesSyncService.Instance;
        readAfterReset.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void CreateForTesting_RejectsNullDependencies()
    {
        Action nullStorage = () => PreferencesSyncService.CreateForTesting(
            null!, _preferences, _store, _identity, null, null);
        Action nullPreferences = () => PreferencesSyncService.CreateForTesting(
            _storage, null!, _store, _identity, null, null);
        Action nullStore = () => PreferencesSyncService.CreateForTesting(
            _storage, _preferences, null!, _identity, null, null);
        Action nullIdentity = () => PreferencesSyncService.CreateForTesting(
            _storage, _preferences, _store, null!, null, null);

        nullStorage.Should().Throw<ArgumentNullException>().Which.ParamName.Should().Be("storage");
        nullPreferences.Should().Throw<ArgumentNullException>().Which.ParamName.Should().Be("preferences");
        nullStore.Should().Throw<ArgumentNullException>().Which.ParamName.Should().Be("cloudStore");
        nullIdentity.Should().Throw<ArgumentNullException>().Which.ParamName.Should().Be("identity");
    }

    [Fact]
    public async Task SignInFailure_StaysLocal_AndSyncsAfterRecovery()
    {
        _preferences.Load();
        _identity.EnsureError = new InvalidOperationException("firebase unavailable");

        await _sync.StartAsync();

        // Identity failure is a deliberate local-only boundary — no fetch,
        // no throw; the first merge simply sees no user.
        _store.FetchCount.Should().Be(0);
        _store.SaveCount.Should().Be(0);

        _identity.EnsureError = null;
        _identity.SignIn("u1"); // UserChanged schedules a sync on its own
        await _sync.PendingSync;
        _store.FetchCount.Should().Be(1);

        _preferences.FontFactor = 1.5;
        await _sync.PendingSync;

        _store.FetchCount.Should().Be(2);
        _store.Document!.Entries["fontFactor"].Value.Should().Be(1.5);
    }

    [Fact]
    public async Task StartAsync_CancelledToken_Propagates()
    {
        _preferences.Load();

        var act = () => _sync.StartAsync(new CancellationToken(canceled: true));

        // OperationCanceledException is deliberately not swallowed by the
        // sign-in failure boundary.
        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task SyncNowAsync_CancelsAPendingDebouncedSync()
    {
        using var sync = PreferencesSyncService.CreateForTesting(
            _storage, _preferences, _store, _identity,
            timeProvider: null, pushDebounce: TimeSpan.FromSeconds(30));

        _preferences.Load();
        _identity.SignIn("u1");
        await sync.StartAsync();

        _preferences.FontFactor = 1.4; // schedules the long debounced push
        var pendingDebounced = sync.PendingSync;

        await sync.SyncNowAsync(); // supersedes it — the delay observes cancellation
        await pendingDebounced;

        _store.Document!.Entries["fontFactor"].Value.Should().Be(1.4);
    }

    [Fact]
    public async Task Dispose_CancelsAPendingDebouncedSync()
    {
        var sync = PreferencesSyncService.CreateForTesting(
            _storage, _preferences, _store, _identity,
            timeProvider: null, pushDebounce: TimeSpan.FromSeconds(30));
        _preferences.Load();
        _identity.SignIn("u1");
        await sync.StartAsync();

        _preferences.FontFactor = 1.4;
        var pendingDebounced = sync.PendingSync;

        sync.Dispose();
        await pendingDebounced; // completes via the cancellation boundary
    }

    [Fact]
    public void Events_BeforeStart_AndAfterDispose_AreIgnored()
    {
        // A service that was never started must ignore preference/auth noise.
        Raise("OnPreferencesChanged");
        Raise("OnUserChanged");
        InvokeScheduleSync();
        _store.FetchCount.Should().Be(0);
        _store.SaveCount.Should().Be(0);

        _sync.Dispose();
        Raise("OnPreferencesChanged");
        Raise("OnUserChanged");
        InvokeScheduleSync();
        _store.FetchCount.Should().Be(0);
        _store.SaveCount.Should().Be(0);

        void Raise(string method) => typeof(PreferencesSyncService)
            .GetMethod(method, System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!
            .Invoke(_sync, [null, EventArgs.Empty]);
        void InvokeScheduleSync() => typeof(PreferencesSyncService)
            .GetMethod("ScheduleSync", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!
            .Invoke(_sync, [TimeSpan.Zero]);
    }

    [Fact]
    public async Task DeviceId_IsReused_WhenAlreadyStored()
    {
        _preferences.Load();
        _inner.Set(PreferencesSyncService.DeviceIdStorageKey, "preset-device-id");

        await StartSignedInAsync();

        _store.Document!.DeviceId.Should().Be("preset-device-id");
    }

    [Fact]
    public async Task StampedKeyWithNoLocalValue_IsNotClaimedInTheMerge()
    {
        // The raw store holds lastLearntPerek=-1 which PreferencesService
        // parses as "unset" — the key is stamped by migration but has no
        // value to claim, so it must not appear in the pushed document.
        _inner.Set(PreferencesService.LastLearntPerekKey, -1);
        _preferences.Load();
        _preferences.LastLearntPerek.Should().BeNull();

        await StartSignedInAsync();

        _storage.GetStampsSnapshot().Should().ContainKey(PreferencesService.LastLearntPerekKey);
        _store.Document!.Entries.Should().NotContainKey(PreferencesService.LastLearntPerekKey);
    }

    [Fact]
    public async Task EmptyRemoteDocument_ConvergesWithoutRewriting()
    {
        _preferences.Load();
        await SeedRemoteAsync(RemoteDoc()); // document exists but carries no entries

        await StartSignedInAsync();

        _store.FetchCount.Should().Be(1);
        _store.SaveCount.Should().Be(1); // only the seed write
    }

    [Fact]
    public async Task RemoteBookmarks_NonStringValue_IsIgnored()
    {
        _preferences.Load();
        _preferences.AddBookmark(4);
        await SeedRemoteAsync(RemoteDoc(("bookmarkedPerakim", 42, 20_000)));

        await StartSignedInAsync();

        _preferences.BookmarkedPerakim.Should().BeEquivalentTo([4]);
    }

    [Fact]
    public async Task RemoteBookmarks_NullJson_KeepsTheLocalSet()
    {
        _preferences.Load();
        _preferences.AddBookmark(4);
        await SeedRemoteAsync(RemoteDoc(("bookmarkedPerakim", "null", 20_000)));

        await StartSignedInAsync();

        // "null" deserializes to no set — the apply is a no-op and the local
        // bookmarks survive.
        _preferences.BookmarkedPerakim.Should().BeEquivalentTo([4]);
    }

    [Fact]
    public async Task RemoteBookmarks_InvalidJson_IsHealedWithTheLocalSet()
    {
        _preferences.Load();
        _preferences.AddBookmark(4);
        await SeedRemoteAsync(RemoteDoc(("bookmarkedPerakim", "{not-json", 20_000)));

        await StartSignedInAsync();

        // The unparseable remote value is rejected and healed with the local
        // serialization at the remote's own timestamp.
        var healed = _store.Document!.Entries["bookmarkedPerakim"];
        healed.Value.Should().Be("[4]");
        healed.UpdatedAtMs.Should().Be(20_000);
        _preferences.BookmarkedPerakim.Should().BeEquivalentTo([4]);
    }

    [Fact]
    public async Task RemoteMaskValues_WithUnexpectedShapes_AreIgnored()
    {
        _preferences.Load();
        _preferences.DivineNameMaskElohimCustom = "המם";
        var doc = RemoteDoc(
            ("divineNameMaskElohim", "not-a-mask-name", 20_000), // unknown option name
            ("divineNameMaskYhwh", 42, 20_000),                  // non-string value
            ("divineNameMaskShaddaiCustom", 42, 20_000));        // non-string custom text
        await SeedRemoteAsync(doc);

        await StartSignedInAsync();

        _preferences.DivineNameMaskElohim.Should().Be(DivineNameMaskOption.Hyphen);
        _preferences.DivineNameMaskYhwh.Should().Be(DivineNameMaskOption.Heh);
        _preferences.DivineNameMaskShaddaiCustom.Should().Be("");
        _preferences.DivineNameMaskElohimCustom.Should().Be("המם");
    }

    [Fact]
    public async Task RemoteLastLearntPerek_NegativeValue_IsNotApplied()
    {
        _preferences.Load();
        _preferences.LastLearntPerek = 3;
        await SeedRemoteAsync(RemoteDoc(("lastLearntPerek", -4L, 20_000)));

        await StartSignedInAsync();

        // The remote entry wins the merge but its negative value fails the
        // >= 0 guard, so the local value is kept.
        _preferences.LastLearntPerek.Should().Be(3);
    }

    [Fact]
    public async Task Fallbacks_KeepTheAppLocalOnly()
    {
        AnonymousUserIdentity.Instance.UserId.Should().BeNull();
        await AnonymousUserIdentity.Instance.EnsureSignedInAsync(CancellationToken.None);

        var fetched = await NullPreferencesCloudStore.Instance.FetchAsync("u1", CancellationToken.None);
        fetched.Should().BeNull();
        await NullPreferencesCloudStore.Instance.SaveAsync("u1", new PreferencesCloudDocument(), CancellationToken.None);
    }
}
