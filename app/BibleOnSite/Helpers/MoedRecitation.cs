using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>Playback identities and selected-reading order for repeated moed occurrences.</summary>
public static class MoedRecitation
{
    public static string PasukKey(MoedDisplayRow row) =>
        PasukKey(row.PerekId, row.PasukNum, row.ClipStartIndex, row.ClipEndIndex, row.SectionId, row.RangeId);

    public static string PasukKey(int perekId, int pasukNum, int clipStart, int clipEnd, int sectionId, int rangeId) =>
        $"pasuk:{perekId}:{pasukNum}:{sectionId}:{rangeId}:{clipStart}:{clipEnd}";

    /// <summary>
    /// Canonical selection includes each deliberate occurrence. Only adjacent
    /// rows within the same perek, section and range share a clip; returning
    /// to a perek later creates a new clip and retains its highlight identity.
    /// </summary>
    public static List<RecitationSegment> SelectedSegments(
        IEnumerable<MoedDisplayRow> rows,
        IEnumerable<(int PerekId, int PasukNum)> selected,
        Func<int, IReadOnlyList<Pasuk>?> pasukimFor,
        Func<int, RecitationTrack?> getTrack,
        Func<int, bool> hasAudio)
    {
        var keys = selected.ToHashSet();
        var runs = new List<List<MoedDisplayRow>>();
        foreach (var row in rows.Where(row => row.Pasuk != null && keys.Contains((row.PerekId, row.PasukNum))))
        {
            var previous = runs.Count == 0 ? null : runs[^1][^1];
            if (previous == null || previous.PerekId != row.PerekId ||
                previous.SectionId != row.SectionId || previous.RangeId != row.RangeId)
            {
                runs.Add([]);
            }
            runs[^1].Add(row);
        }

        var segments = new List<RecitationSegment>();
        foreach (var run in runs)
        {
            var first = run[0];
            var track = getTrack(first.PerekId);
            var pasukim = pasukimFor(first.PerekId);
            if (track?.AlignmentStatus != "ready" || pasukim == null ||
                !hasAudio(first.PerekId) || !track.Matches(pasukim))
            {
                continue;
            }
            var words = run.Select(row => RecitationRangePlanner.WordsForClippedRow(
                track, row.PasukNum, row.ClipStartIndex, row.ClipEndIndex)).ToList();
            if (words.Any(range => range.Count == 0))
            {
                continue;
            }
            segments.Add(new RecitationSegment(first.PerekId, pasukim, null, null,
                words.Select(range => (range[0].StartMs!.Value, range[^1].EndMs!.Value)).ToList())
                { SectionId = first.SectionId, RangeId = first.RangeId });
        }
        return segments;
    }
}
