public static class MobileE2EShardFilter
{
    public static string Create(string? selection)
    {
        if (string.IsNullOrEmpty(selection)) { return string.Empty; }
        var shards = selection.Split(',');
        if (shards.Any(shard => shard is not ("1" or "2" or "3")) || shards.Distinct().Count() != shards.Length)
        {
            throw new ArgumentException("Select distinct iOS shard values 1, 2 or 3.", nameof(selection));
        }
        return "&(" + string.Join("|", shards.Select(shard => $"(Shard={shard})")) + ")";
    }
}
