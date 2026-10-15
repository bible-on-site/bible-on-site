using Xunit;

public sealed class MobileE2EShardFilterTests
{
    [Fact]
    public void CiAndLocalGroupsUseParenthesizedPredicatesWithoutChangingTheUnshardedRun()
    {
        Assert.Equal(string.Empty, MobileE2EShardFilter.Create(null));
        Assert.Equal(string.Empty, MobileE2EShardFilter.Create(""));
        Assert.Equal("&((Shard=3))", MobileE2EShardFilter.Create("3"));
        Assert.Equal("&((Shard=1)|(Shard=3))", MobileE2EShardFilter.Create("1,3"));
    }

    [Theory]
    [InlineData("4")]
    [InlineData("1,1")]
    [InlineData("1,")]
    [InlineData("1)|(Category=Unit")]
    public void InvalidOrRepeatedGroupsFailBeforeDiscovery(string selection)
        => Assert.Throws<ArgumentException>(() => MobileE2EShardFilter.Create(selection));
}
