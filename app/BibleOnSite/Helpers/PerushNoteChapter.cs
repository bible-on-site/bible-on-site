using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>Only compressed bytes and note identities survive outside realized reader cells.</summary>
internal sealed class PerushNoteChapter
{
    private readonly byte[] _blob;
    private readonly Dictionary<int, List<int>> _perushIdsByPasuk;

    // Decoded text is cached per pasuk, not per cell: one zlib scan of the
    // chapter blob serves every perush cell of that pasuk. The LRU bounds the
    // decoded text to roughly two viewports so recycled cells stop rescanning.
    private const int PasukCacheCapacity = 24;
    private readonly object _cacheLock = new();
    private readonly LinkedList<int> _lruPesukim = new();
    private readonly Dictionary<int, PasukSlice> _pasukCache = new();
    private int _decodeScans;

    private sealed class PasukSlice(LinkedListNode<int> node, Dictionary<int, List<string>> notes)
    {
        internal LinkedListNode<int> Node { get; } = node;
        internal Dictionary<int, List<string>> Notes { get; } = notes;
    }

    /// <summary>Blob scans performed — diagnostics and tests watch this stay low.</summary>
    internal int DecodeScans => _decodeScans;

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

    private List<string> NotesFor(int pasuk, int perushId)
    {
        lock (_cacheLock)
        {
            if (!_pasukCache.TryGetValue(pasuk, out var slice))
            {
                var notes = PerushNoteBlob.Decode(_blob, (_, verse) => verse == pasuk)
                    .GroupBy(n => n.PerushId)
                    .ToDictionary(g => g.Key,
                        g => g.OrderBy(n => n.NoteIdx).Select(n => n.Content).ToList());
                ++_decodeScans;
                slice = new PasukSlice(_lruPesukim.AddFirst(pasuk), notes);
                _pasukCache[pasuk] = slice;
                if (_pasukCache.Count > PasukCacheCapacity)
                {
                    var tail = _lruPesukim.Last!.Value;
                    _lruPesukim.RemoveLast();
                    _pasukCache.Remove(tail);
                }
            }
            else
            {
                _lruPesukim.Remove(slice.Node);
                _lruPesukim.AddFirst(slice.Node);
            }
            return slice.Notes.GetValueOrDefault(perushId) ?? [];
        }
    }

    internal List<PerushNoteDisplay> GetDisplays(int pasuk, IReadOnlyList<Perush> perushim,
        IReadOnlySet<int>? selected = null, IReadOnlyList<PerushNoteDisplay>? existing = null)
    {
        var available = _perushIdsByPasuk.GetValueOrDefault(pasuk) ?? [];
        return perushim.Where(p => available.Contains(p.Id) && (selected == null || selected.Contains(p.Id)))
            .Select(p => existing?.FirstOrDefault(d => d.PerushId == p.Id) ?? new PerushNoteDisplay
            {
                PerushId = p.Id,
                PerushName = p.Name,
                ContentLoader = () => Task.Run(() => NotesFor(pasuk, p.Id))
            }).ToList();
    }
}
