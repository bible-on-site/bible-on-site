using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

// The iOS CI leg splits the suite across two simulators keyed on the Shard
// trait (#2083). An iOS-applicable class without exactly one Shard=1|2 value
// matches no shard filter and would silently drop from every iOS run while
// still running on Android — this guard keeps the partition complete.
[Trait("Category", "Unit")]
public sealed class ShardAssignmentTests
{
    [Fact]
    public void IosApplicableClassesCarryOneShardValue()
    {
        var offenders = typeof(MobileDeviceTest).Assembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false })
            .Select(type => (type, traits: TraitsOf(type)))
            .Where(entry => entry.traits.Contains(("Category", "MobileE2E")))
            .Where(entry => entry.traits.Contains(("Platform", "Shared"))
                || entry.traits.Contains(("Platform", "iOS")))
            .Select(entry => (entry.type, shards: entry.traits
                .Where(trait => trait.Name == "Shard")
                .Select(trait => trait.Value)
                .ToArray()))
            .Where(entry => entry.shards is not ["1"] and not ["2"])
            .Select(entry => $"{entry.type.FullName} (Shard: {string.Join(", ", entry.shards)})")
            .ToArray();
        Assert.Empty(offenders);
    }

    private static List<(string Name, string Value)> TraitsOf(Type type) =>
        type.GetCustomAttributesData()
            .Where(attribute => attribute.AttributeType.Name == "TraitAttribute"
                && attribute.ConstructorArguments.Count == 2)
            .Select(attribute => (
                (string)attribute.ConstructorArguments[0].Value!,
                (string)attribute.ConstructorArguments[1].Value!))
            .ToList();
}
