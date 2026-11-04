using BibleOnSite.Services;
using FluentAssertions;
using Xunit;

namespace BibleOnSite.Tests.Services;

public class SyncStampingPreferencesStorageTests
{
    private long _now = 1_000;

    private (SyncStampingPreferencesStorage storage, InMemoryPreferencesStorage inner) Create()
    {
        var inner = new InMemoryPreferencesStorage();
        return (new SyncStampingPreferencesStorage(inner, () => _now), inner);
    }

    [Fact]
    public void Set_RecordsWriteStamp()
    {
        var (storage, _) = Create();
        storage.Set("fontFactor", 1.5);

        var stamps = storage.GetStampsSnapshot();
        stamps["fontFactor"].UpdatedAtMs.Should().Be(1_000);
        stamps["fontFactor"].Tombstone.Should().BeFalse();
    }

    [Fact]
    public void Remove_RecordsTombstoneStamp()
    {
        var (storage, _) = Create();
        storage.Set("lastLearntPerek", 5);
        _now = 2_000;
        storage.Remove("lastLearntPerek");

        var stamps = storage.GetStampsSnapshot();
        stamps["lastLearntPerek"].UpdatedAtMs.Should().Be(2_000);
        stamps["lastLearntPerek"].Tombstone.Should().BeTrue();
    }

    [Fact]
    public void Stamps_PersistIntoInnerStorage_AndReload()
    {
        var (storage, inner) = Create();
        storage.Set("masoraMenuEnabled", true);

        // A second decorator over the same inner storage sees the persisted stamps.
        var reloaded = new SyncStampingPreferencesStorage(inner, () => _now);
        reloaded.GetStampsSnapshot().Should().ContainKey("masoraMenuEnabled");
        reloaded.GetStampsSnapshot()["masoraMenuEnabled"].UpdatedAtMs.Should().Be(1_000);
    }

    [Fact]
    public void StampMapKey_IsWrittenToStorage_ButNeverStamped()
    {
        var (storage, _) = Create();
        storage.Set("fontFactor", 1.2);

        storage.ContainsKey(SyncStampingPreferencesStorage.StampsStorageKey).Should().BeTrue();
        storage.GetStampsSnapshot().Should().NotContainKey(SyncStampingPreferencesStorage.StampsStorageKey);
    }

    [Fact]
    public void OverrideStamp_SetsExactWinnerMetadata()
    {
        var (storage, _) = Create();
        storage.Set("fontFactor", 1.2); // stamped 1000
        storage.OverrideStamp("fontFactor", 777, tombstone: false);

        storage.GetStampsSnapshot()["fontFactor"].UpdatedAtMs.Should().Be(777);
    }

    [Fact]
    public void StampAsNow_UsesInjectedClock()
    {
        var (storage, _) = Create();
        _now = 5_555;
        storage.StampAsNow("fontFactor");

        storage.GetStampsSnapshot()["fontFactor"].UpdatedAtMs.Should().Be(5_555);
    }

    [Fact]
    public void CorruptStampJson_ResetsToEmpty()
    {
        var inner = new InMemoryPreferencesStorage();
        inner.Set(SyncStampingPreferencesStorage.StampsStorageKey, "{not json");

        var storage = new SyncStampingPreferencesStorage(inner, () => _now);
        storage.GetStampsSnapshot().Should().BeEmpty();
    }
}
