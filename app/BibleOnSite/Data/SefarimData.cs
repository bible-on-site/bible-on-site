namespace BibleOnSite.Data;

/// <summary>
/// Represents a group of Sefarim (Torah, Neviim, Ketuvim).
/// </summary>
public enum SeferGroup
{
    Torah = 1,
    Neviim = 2,
    Ketuvim = 3
}

/// <summary>
/// Metadata for a group of Sefarim.
/// </summary>
public class SeferGroupMetaData
{
    public required string Header { get; set; }
    public required string Name { get; set; }
    public int From { get; set; }
    public int To { get; set; }
}

/// <summary>
/// Static data about Sefarim structure.
/// </summary>
public static class SefarimData
{
    public static readonly Dictionary<int, SeferGroupMetaData> SefarimGroups = new()
    {
        [1] = new SeferGroupMetaData { Header = "תורה", Name = "tora", From = 1, To = 5 },
        [2] = new SeferGroupMetaData { Header = "נביאים", Name = "neviim", From = 6, To = 24 },
        [3] = new SeferGroupMetaData { Header = "כתובים", Name = "ketuvim", From = 25, To = 35 }
    };

    /// <summary>
    /// Gets the SeferGroup for a given sefer ID.
    /// </summary>
    public static SeferGroup GetSeferGroup(int seferId)
    {
        foreach (var entry in SefarimGroups)
        {
            if (seferId >= entry.Value.From && seferId <= entry.Value.To)
            {
                return (SeferGroup)entry.Key;
            }
        }
        return SeferGroup.Torah; // Default fallback
    }

    /// <summary>
    /// Gets the sefer ID range (from, to) for a given group index.
    /// </summary>
    public static (int From, int To) GetSeferGroupRange(int groupIndex)
    {
        // Map 0-based index to 1-based group key
        var groupKey = groupIndex + 1;

        if (SefarimGroups.TryGetValue(groupKey, out var group))
        {
            return (group.From, group.To);
        }

        // Default to Torah range
        return (1, 5);
    }
}
