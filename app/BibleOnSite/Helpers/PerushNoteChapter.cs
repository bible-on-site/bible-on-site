using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>Only compressed bytes and note identities survive outside realized reader cells.</summary>
internal sealed class PerushNoteChapter
{
    private readonly byte[] _blob;
    private readonly Dictionary<int, List<int>> _perushIdsByPasuk;

    internal PerushNoteChapter(byte[] blob)
    {
        _blob = blob;
        _perushIdsByPasuk = PerushNoteBlob.ReadHeaders(blob)
            .GroupBy(h => h.Pasuk)
            .ToDictionary(g => g.Key, g => g.Select(h => h.PerushId).Distinct().ToList());
    }

    internal IEnumerable<int> AvailablePerushIds(int firstPasuk, int lastPasuk) =>
        _perushIdsByPasuk.Where(p => p.Key >= firstPasuk && p.Key <= lastPasuk)
            .SelectMany(p => p.Value).Distinct();

    internal List<PerushNoteDisplay> GetDisplays(int pasuk, IReadOnlyList<Perush> perushim,
        IReadOnlySet<int>? selected = null, IReadOnlyList<PerushNoteDisplay>? existing = null)
    {
        var available = _perushIdsByPasuk.GetValueOrDefault(pasuk) ?? [];
        return perushim.Where(p => available.Contains(p.Id) && (selected == null || selected.Contains(p.Id)))
            .Select(p => existing?.FirstOrDefault(d => d.PerushId == p.Id) ?? new PerushNoteDisplay
            {
                PerushId = p.Id,
                PerushName = p.Name,
                ContentLoader = () => Task.Run(() => PerushNoteBlob.Decode(_blob,
                    (id, verse) => id == p.Id && verse == pasuk)
                    .OrderBy(n => n.NoteIdx).Select(n => n.Content).ToList())
            }).ToList();
    }
}
