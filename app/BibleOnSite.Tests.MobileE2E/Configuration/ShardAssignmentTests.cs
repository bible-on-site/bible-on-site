using System.Reflection;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

// Every iOS-applicable fact belongs to exactly one of the three CI runners.
// The local two-device coordinator combines groups 1 and 3 on its first device.
[Trait("Category", "Unit")]
public sealed class ShardAssignmentTests
{
    [Fact]
    public void EveryIosScenarioHasOneShardAndTheTenCasesRemainBalanced()
    {
        var scenarios = typeof(MobileDeviceTest).Assembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false })
            .Select(type => (type, traits: TraitsOf(type)))
            .Where(entry => entry.traits.Contains(("Category", "MobileE2E")))
            .Where(entry => entry.traits.Contains(("Platform", "Shared"))
                || entry.traits.Contains(("Platform", "iOS")))
            .SelectMany(entry => entry.type.GetMethods()
                .Where(method => method.GetCustomAttributesData().Any(attribute =>
                    attribute.AttributeType.Name is "FactAttribute" or "TheoryAttribute"))
                .Select(method => (id: $"{entry.type.FullName}.{method.Name}",
                    shards: entry.traits.Concat(TraitsOf(method))
                        .Where(trait => trait.Name == "Shard").Select(trait => trait.Value).ToArray())))
            .ToArray();
        Assert.Empty(scenarios.Where(entry => entry.shards is not ["1"] and not ["2"] and not ["3"])
            .Select(entry => $"{entry.id} (Shard: {string.Join(", ", entry.shards)})"));
        Assert.Equal(10, scenarios.Length);
        Assert.Equal([3, 4, 3], new[] { "1", "2", "3" }
            .Select(shard => scenarios.Count(entry => entry.shards.SequenceEqual([shard]))).ToArray());
    }

    private static List<(string Name, string Value)> TraitsOf(MemberInfo member) =>
        member.GetCustomAttributesData()
            .Where(attribute => attribute.AttributeType.Name == "TraitAttribute"
                && attribute.ConstructorArguments.Count == 2)
            .Select(attribute => (
                (string)attribute.ConstructorArguments[0].Value!,
                (string)attribute.ConstructorArguments[1].Value!))
            .ToList();
}
