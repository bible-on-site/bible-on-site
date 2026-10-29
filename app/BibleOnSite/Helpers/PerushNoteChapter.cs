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
    // The lock guards only the LRU bookkeeping: the scan itself is a pure
    // function of the immutable blob, so it runs outside the lock and each
    // pasuk's Lazy shares a single scan between its concurrent misses — a
    // fling's worth of commentary cells never serializes behind the cache.
    private const int PasukCacheCapacity = 24;
    private readonly object _cacheLock = new();
    private readonly LinkedList<int> _lruPesukim = new();
    private readonly Dictionary<int, PasukSlice> _pasukCache = new();
    private int _decodeScans;

    private sealed class PasukSlice(LinkedListNode<int> node, Func<Dictionary<int, List<string>>> decode)
    {
        internal LinkedListNode<int> Node { get; } = node;
        internal Lazy<Dictionary<int, List<string>>> Notes { get; } =
            new(decode, LazyThreadSafetyMode.ExecutionAndPublication);
    }

    /// <summary>Blob scans performed — diagnostics and tests watch this stay low.</summary>
    internal int DecodeScans => _decodeScans;

    internal PerushNoteChapter(byte[] blob)
    {
        _blob = blob;
        _perushIdsByPasuk = PerushNoteBlob.ReadHeaders(blob)
            .GroupBy(h => h.Pasuk)
            .ToDictionary(g => g.Key, g => g.Select(h => h.PerushId).Distinct().ToList());
        PerushIds = [.. _perushIdsByPasuk.Values.SelectMany(ids => ids).Distinct().Order()];
    }

    /// <summary>Distinct perush ids with notes anywhere in the perek, ascending.</summary>
    internal IReadOnlyList<int> PerushIds { get; }

    internal IEnumerable<int> AvailablePerushIds(int firstPasuk, int lastPasuk) =>
        _perushIdsByPasuk.Where(p => p.Key >= firstPasuk && p.Key <= lastPasuk)
            .SelectMany(p => p.Value).Distinct();

    private List<string> NotesFor(int pasuk, int perushId)
    {
        PasukSlice slice;
        lock (_cacheLock)
        {
            if (_pasukCache.TryGetValue(pasuk, out var cached))
            {
                _lruPesukim.Remove(cached.Node);
                _lruPesukim.AddFirst(cached.Node);
                slice = cached;
            }
            else
            {
                slice = new PasukSlice(_lruPesukim.AddFirst(pasuk), () => DecodePasuk(pasuk));
                _pasukCache[pasuk] = slice;
                if (_pasukCache.Count > PasukCacheCapacity)
                {
                    var tail = _lruPesukim.Last!.Value;
                    _lruPesukim.RemoveLast();
                    _pasukCache.Remove(tail);
                }
            }
        }
        try
        {
            return slice.Notes.Value.GetValueOrDefault(perushId) ?? [];
        }
        catch //NOSONAR — the failure rethrows; the handler only evicts the poisoned slice so retries rescan.
        {
            // A failed scan must not stay cached: evict the slice so the next
            // caller retries (e.g. a transient OOM under scroll pressure).
            lock (_cacheLock)
            {
                if (ReferenceEquals(_pasukCache.GetValueOrDefault(pasuk), slice))
                {
                    _pasukCache.Remove(pasuk);
                    _lruPesukim.Remove(slice.Node);
                }
            }
            throw;
        }
    }

    /// <summary>One blob scan for a single pasuk; the Lazy shares it between concurrent misses.</summary>
    private Dictionary<int, List<string>> DecodePasuk(int pasuk)
    {
        var notes = PerushNoteBlob.Decode(_blob, (_, verse) => verse == pasuk)
            .GroupBy(n => n.PerushId)
            .ToDictionary(g => g.Key,
                g => g.OrderBy(n => n.NoteIdx).Select(n => n.Content).ToList());
        Interlocked.Increment(ref _decodeScans);
        return notes;
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
