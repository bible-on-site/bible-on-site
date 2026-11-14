namespace BibleOnSite.Models;

/// <summary>
/// Shared persisted reading metrics for one content item (issue #2607) — the
/// same contract MySQL, the GraphQL API and the packaged sqlite carry.
/// <see cref="WordCount"/> null = metric unknown/not computed; 0 = verified
/// empty body — never a fabricated estimate.
/// </summary>
public sealed record ReadingMetric
{
    /// <summary>Words counted over the complete content; null when unknown.</summary>
    public int? WordCount { get; init; }

    /// <summary>
    /// ceil(word_count * 60 / words_per_minute); null when word_count is.
    /// A silent-reading baseline — not study time, recitation length or
    /// measured reader performance.
    /// </summary>
    public int? EstimatedSeconds { get; init; }

    /// <summary>Baseline Hebrew silent-reading rate the estimate used.</summary>
    public int WordsPerMinute { get; init; }

    /// <summary>Counting-policy version that produced the row.</summary>
    public int CalcVersion { get; init; }

    /// <summary>sha256 hex of the normalized counted text.</summary>
    public string SourceHash { get; init; } = string.Empty;
}

/// <summary>
/// Ordered reading-position unit enabling word-weighted progress without
/// re-parsing rendered text: pasuk rows for a perek, readable blocks for
/// article/entry bodies, note coordinates for perushim.
/// </summary>
public sealed record ReadingProgressUnit
{
    /// <summary>
    /// Pasuk number for a perek, block index for article/entry bodies, or a
    /// "pasuk:noteIdx" coordinate for perush notes.
    /// </summary>
    public required string Key { get; init; }

    /// <summary>Words in this unit.</summary>
    public int WordCount { get; init; }

    /// <summary>Words up to and including this unit, in canonical order.</summary>
    public int CumulativeWords { get; init; }
}
