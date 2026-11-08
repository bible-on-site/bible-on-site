namespace BibleOnSite.Models;

/// <summary>
/// The shared reading-unit contract's inclusive canonical scripture bounds
/// (docs/data/reading-units.md), common to every division: coordinates are
/// {perekId, pasuk, segmentIndex?} where perekId is the global canonical
/// perek id, pasuk is 1-based inside it, and segmentIndex is an optional
/// 0-based intra-pasuk bound (null = whole-pasuk edge).
/// </summary>
public interface IScriptureRange
{
    int StartPerekId { get; }
    int StartPasuk { get; }
    int? StartSegmentIndex { get; }
    int EndPerekId { get; }
    int EndPasuk { get; }
    int? EndSegmentIndex { get; }
}
