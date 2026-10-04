using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>Maps the player's position to approved canonical words, including joined verse clips.</summary>
public sealed class RecitationTimeline
{
    private readonly List<(RecitationWord Word, double Start, double End)> _words = [];

    public RecitationTimeline(RecitationTrack? track) : this(track, null)
    {
    }

    public RecitationTimeline(RecitationTrack? track, IReadOnlyList<(double Start, double End)>? ranges)
    {
        if (track?.AlignmentStatus != "ready")
        {
            return;
        }

        if (ranges == null)
        {
            _words.AddRange(track.Words.Select(w => (w, w.StartMs!.Value, w.EndMs!.Value)));
            return;
        }

        double cursor = 0;
        foreach (var range in ranges)
        {
            foreach (var word in track.Words.Where(w => w.StartMs >= range.Start && w.EndMs <= range.End))
            {
                _words.Add((word, cursor + word.StartMs!.Value - range.Start, cursor + word.EndMs!.Value - range.Start));
            }
            cursor += range.End - range.Start;
        }
    }

    public RecitationWord? WordAt(double milliseconds)
    {
        if (!double.IsFinite(milliseconds))
        {
            return null;
        }

        int low = 0, high = _words.Count;
        while (low < high)
        {
            int middle = low + (high - low) / 2;
            if (_words[middle].Start <= milliseconds)
            {
                low = middle + 1;
            }
            else
            {
                high = middle;
            }
        }
        return low > 0 && milliseconds < _words[low - 1].End ? _words[low - 1].Word : null;
    }
}
