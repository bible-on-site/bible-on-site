namespace BibleOnSite.Helpers;

/// <summary>Reuses one query pattern across an offline vocabulary scan.</summary>
internal sealed class SearchSpellingMatcher
{
    private readonly string _term;
    private readonly int _limit;
    private readonly Dictionary<char, ulong> _positions = new();

    public SearchSpellingMatcher(string term, int limit)
    {
        _term = term;
        _limit = limit;
        if (term.Length > 64) { return; }
        for (var i = 0; i < term.Length; i++)
        {
            _positions[term[i]] = _positions.GetValueOrDefault(term[i]) | (1UL << i);
        }
    }

    public int Distance(string candidate)
    {
        if (Math.Abs(candidate.Length - _term.Length) > _limit) { return _limit + 1; }
        if (_term.Length is 0 or > 64) { return SearchText.Distance(candidate, _term, _limit); }

        // Myers' bit-vector recurrence evaluates a whole edit-distance row in
        // word operations. Normalized search terms fit in one 64-bit word;
        // longer callers retain the general implementation.
        var positive = ulong.MaxValue;
        ulong negative = 0;
        var score = _term.Length;
        var high = 1UL << (_term.Length - 1);
        for (var i = 0; i < candidate.Length; i++)
        {
            var equal = _positions.GetValueOrDefault(candidate[i]);
            var vertical = equal | negative;
            var horizontal = (((equal & positive) + positive) ^ positive) | equal;
            var add = negative | ~(horizontal | positive);
            var subtract = positive & horizontal;
            if ((add & high) != 0) { score++; }
            else if ((subtract & high) != 0) { score--; }
            add = (add << 1) | 1;
            subtract <<= 1;
            positive = subtract | ~(vertical | add);
            negative = add & vertical;
            // Each remaining character can lower the score by at most one.
            if (score - (candidate.Length - i - 1) > _limit) { return _limit + 1; }
        }
        return score;
    }
}
