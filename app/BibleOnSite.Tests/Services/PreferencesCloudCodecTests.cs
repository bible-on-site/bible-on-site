using BibleOnSite.Services;
using FluentAssertions;
using Xunit;

namespace BibleOnSite.Tests.Services;

public class PreferencesCloudCodecTests
{
    private static Dictionary<string, object?> Entry(object? value, long updatedAt, string? deviceId = null)
    {
        var map = new Dictionary<string, object?> { ["value"] = value, ["updatedAt"] = updatedAt };
        if (deviceId != null)
        {
            map["deviceId"] = deviceId;
        }
        return map;
    }

    [Fact]
    public void FromFirestoreMap_ReturnsNull_WhenSnapshotEmpty()
    {
        PreferencesCloudCodec.FromFirestoreMap(null).Should().BeNull();
    }

    [Fact]
    public void RoundTrip_PreservesEntriesTombstonesAndMetadata()
    {
        var document = new PreferencesCloudDocument { DeviceId = "dev-1" };
        document.Entries["fontFactor"] = new CloudPreferenceEntry
        {
            Value = 1.5, UpdatedAtMs = 42, DeviceId = "dev-1",
        };
        document.Entries["lastLearntPerek"] = new CloudPreferenceEntry
        {
            Tombstone = true, UpdatedAtMs = 43, DeviceId = "dev-1",
        };
        document.Entries["perekToLoad"] = new CloudPreferenceEntry
        {
            Value = 1L, UpdatedAtMs = 44,
        };

        var map = PreferencesCloudCodec.ToFirestoreMap(document);
        var parsed = PreferencesCloudCodec.FromFirestoreMap(
            map.ToDictionary(p => (string)p.Key, p => p.Value));

        parsed.Should().NotBeNull();
        parsed!.SchemaVersion.Should().Be(PreferencesCloudDocument.CurrentSchemaVersion);
        parsed.DeviceId.Should().Be("dev-1");
        parsed.Entries["fontFactor"].Value.Should().Be(1.5);
        parsed.Entries["fontFactor"].UpdatedAtMs.Should().Be(42);
        parsed.Entries["lastLearntPerek"].Tombstone.Should().BeTrue();
        parsed.Entries["lastLearntPerek"].Value.Should().BeNull();
        parsed.Entries["perekToLoad"].Value.Should().Be(1L);
    }

    [Fact]
    public void FromFirestoreMap_SkipsMalformedEntries()
    {
        var map = new Dictionary<string, object?>
        {
            ["schemaVersion"] = 1L,
            ["entries"] = new Dictionary<string, object?>
            {
                // Missing updatedAt — nothing to order by.
                ["noStamp"] = new Dictionary<string, object?> { ["value"] = 1L },
                // Non-canonical value — an array/map is not a preference value.
                ["badValue"] = new Dictionary<string, object?>
                {
                    ["value"] = new Dictionary<string, object?> { ["nested"] = true },
                    ["updatedAt"] = 5L,
                },
                // Non-map entry.
                ["notAMap"] = 7L,
                ["good"] = Entry(true, 9L),
            },
        };

        var parsed = PreferencesCloudCodec.FromFirestoreMap(map);

        parsed.Should().NotBeNull();
        parsed!.Entries.Should().HaveCount(1);
        parsed.Entries["good"].Value.Should().Be(true);
    }

    [Fact]
    public void FromFirestoreMap_ToleratesMissingEntriesAndFutureSchema()
    {
        var parsed = PreferencesCloudCodec.FromFirestoreMap(
            new Dictionary<string, object?> { ["schemaVersion"] = 99L, ["futureField"] = "x" });

        parsed.Should().NotBeNull();
        parsed!.SchemaVersion.Should().Be(99);
        parsed.Entries.Should().BeEmpty();
    }

    [Fact]
    public void Canonicalize_MapsWholeNumbersToLong()
    {
        PreferencesCloudCodec.Canonicalize(3).Should().Be(3L);
        PreferencesCloudCodec.Canonicalize(3u).Should().Be(3L);
        PreferencesCloudCodec.Canonicalize((short)3).Should().Be(3L);
        PreferencesCloudCodec.Canonicalize(1.25f).Should().Be(1.25);
        PreferencesCloudCodec.Canonicalize("x").Should().Be("x");
        PreferencesCloudCodec.Canonicalize(true).Should().Be(true);
        PreferencesCloudCodec.Canonicalize(null).Should().BeNull();
    }

    [Fact]
    public void CoercionHelpers_HandleFirestoreNumberShapes()
    {
        PreferencesCloudCodec.AsInt(7L, -1).Should().Be(7);
        PreferencesCloudCodec.AsInt(7.0, -1).Should().Be(7);
        PreferencesCloudCodec.AsInt(null, -1).Should().Be(-1);
        PreferencesCloudCodec.AsDouble(2L, -1).Should().Be(2.0);
        PreferencesCloudCodec.AsDouble(null, -1).Should().Be(-1.0);
        PreferencesCloudCodec.AsBool(true, false).Should().BeTrue();
        PreferencesCloudCodec.AsBool(1L, false).Should().BeFalse();
    }
}
