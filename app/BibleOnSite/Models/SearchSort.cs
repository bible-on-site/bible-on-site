namespace BibleOnSite.Models;

public enum SearchSort
{
    Relevance,
    Generation
}

public sealed record SearchOrdering(SearchSort Sort, IReadOnlyDictionary<int, int> CommentaryYears)
{
    public static SearchOrdering Relevant { get; } = new(SearchSort.Relevance, new Dictionary<int, int>());
    public int YearFor(int perushId) => perushId == 0 ? int.MinValue : CommentaryYears.GetValueOrDefault(perushId, int.MaxValue);
}
