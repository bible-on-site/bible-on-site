using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Shared playback planning for range-bounded readers (מסורה, פרשה and the
/// upcoming מועדים sections): each unit decomposes into ordered perek slices,
/// and each slice becomes at most one clip — bounded exactly to its canonical
/// pasuk/segment edges through approved word timings, never outside them.
/// </summary>
public static class RecitationRangePlanner
{
    /// <summary>
    /// The canonical words a perek slice reads, clipped by its optional
    /// intra-pasuk segment edges. Segment indexes are the contract's 0-based
    /// canonical positions (Masoretic breaks produce no words), so a word —
    /// whose <see cref="RecitationWord.Segment"/> is 1-based — participates
    /// when its canonical index lands inside the slice bounds.
    /// </summary>
    public static List<RecitationWord> WordsForSlice(
        MasoraUnitText.PerekSlice slice, RecitationTrack track, int perekPasukCount)
    {
        var endPasuk = Math.Min(slice.EndPasuk, perekPasukCount);
        var words = track.GetWordsBetweenPasukim(slice.StartPasuk, endPasuk);
        if (slice.StartSegmentIndex == null && slice.EndSegmentIndex == null)
        {
            return words.ToList();
        }

        return words.Where(w =>
            (w.Pasuk != slice.StartPasuk || slice.StartSegmentIndex is not int start || w.Segment - 1 >= start) &&
            (w.Pasuk != slice.EndPasuk || slice.EndSegmentIndex is not int end || w.Segment - 1 <= end))
            .ToList();
    }

    /// <summary>
    /// The words of a single pasuk row clipped to its unit bounds — the
    /// segment edges <see cref="MasoraUnitText"/> clips the displayed pasuk
    /// to. An unclipped row keeps the whole pasuk's words.
    /// </summary>
    public static List<RecitationWord> WordsForClippedRow(
        RecitationTrack track, int pasukNum, int clipStartIndex, int clipEndIndex) =>
        track.GetWords(pasukNum)
            .Where(w => w.Segment - 1 >= clipStartIndex && w.Segment - 1 <= clipEndIndex)
            .ToList();

    /// <summary>
    /// Plans perek clips for ordered unit slices. Aligned ("ready") tracks
    /// clip at exact word boundaries — including a slice that starts or ends
    /// inside a pasuk at a Masoretic break; verse-pause playback keeps the
    /// perek reader's cadence inside the slice while original-pause playback
    /// keeps the recording's own spacing. An unaligned track can only play
    /// whole-perek slices: a partial slice has no approved boundary to stop
    /// at. Slices with no installed audio are skipped — playback never
    /// reaches outside the unit's ranges.
    /// </summary>
    public static List<RecitationSegment> SegmentsForSlices(
        IEnumerable<MasoraUnitText.PerekSlice> slices,
        Func<int, IReadOnlyList<Pasuk>?> pasukimFor,
        Func<int, RecitationTrack?> getTrack,
        Func<int, bool> hasAudio,
        bool versePause)
    {
        var segments = new List<RecitationSegment>();
        foreach (var slice in slices)
        {
            var pasukim = pasukimFor(slice.PerekId);
            var track = getTrack(slice.PerekId);
            if (pasukim == null || track == null || !hasAudio(slice.PerekId))
            {
                continue;
            }

            var endPasuk = Math.Min(slice.EndPasuk, pasukim.Count);
            var wholePerek = slice.StartPasuk <= 1 && endPasuk >= pasukim.Count &&
                slice.StartSegmentIndex is not > 0 && slice.EndSegmentIndex == null;
            if (track.AlignmentStatus == "ready" && track.Matches(pasukim))
            {
                var sliceWords = WordsForSlice(slice, track, pasukim.Count);
                if (sliceWords.Count == 0)
                {
                    continue;
                }

                var ranges = versePause
                    ? sliceWords.GroupBy(w => w.Pasuk).OrderBy(g => g.Key)
                        .Select(g => (g.First().StartMs!.Value, g.Last().EndMs!.Value)).ToList()
                    : [(sliceWords[0].StartMs!.Value, sliceWords[^1].EndMs!.Value)];
                segments.Add(new RecitationSegment(slice.PerekId, pasukim, null, null, ranges)
                    { RangeId = slice.RangeId });
            }
            else if (wholePerek)
            {
                segments.Add(new RecitationSegment(slice.PerekId, pasukim, null, null, null)
                    { RangeId = slice.RangeId });
            }
            // A partial slice on an unaligned track has no approved boundary — skip.
        }

        return segments;
    }
}
