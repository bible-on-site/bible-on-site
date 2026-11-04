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
        public string? UserId { get; private set; }
        public int EnsureCalls { get; private set; }

        public event EventHandler? UserChanged;

        public Task EnsureSignedInAsync(CancellationToken cancellationToken = default)
        {
            EnsureCalls++;
            return Task.CompletedTask;
        }

        public void SignIn(string userId)
        {
            UserId = userId;
            UserChanged?.Invoke(this, EventArgs.Empty);
        }

        public void SignOut()
        {
            UserId = null;
            UserChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    private sealed class FakeCloudStore : IPreferencesCloudStore
    {
        public PreferencesCloudDocument? Document { get; private set; }
        public int FetchCount { get; private set; }
        public int SaveCount { get; private set; }
        public Exception? FetchError { get; set; }

        public Task<PreferencesCloudDocument?> FetchAsync(string userId, CancellationToken cancellationToken = default)
        {
            FetchCount++;
            if (FetchError != null)
            {
                throw FetchError;
            }
            return Task.FromResult(Document);
        }

        public Task SaveAsync(string userId, PreferencesCloudDocument document, CancellationToken cancellationToken = default)
        {
            SaveCount++;
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
    public async Task Fallbacks_KeepTheAppLocalOnly()
    {
        AnonymousUserIdentity.Instance.UserId.Should().BeNull();
        await AnonymousUserIdentity.Instance.EnsureSignedInAsync(CancellationToken.None);

        var fetched = await NullPreferencesCloudStore.Instance.FetchAsync("u1", CancellationToken.None);
        fetched.Should().BeNull();
        await NullPreferencesCloudStore.Instance.SaveAsync("u1", new PreferencesCloudDocument(), CancellationToken.None);
    }
}
