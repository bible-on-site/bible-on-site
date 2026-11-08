using BibleOnSite.Models;
using System.IO.Compression;

namespace BibleOnSite.Helpers;

/// <summary>Only compressed bytes and note identities survive outside realized reader cells.</summary>
internal sealed class PerushNoteChapter
{
    private readonly Dictionary<int, List<int>> _perushIdsByPasuk;

    // Decoded text is cached per pasuk, not per cell: one inflation of the
    // pasuk's chunk serves every perush cell of that pasuk. The LRU bounds
    // the decoded text to roughly two viewports so recycled cells stop
    // re-inflating. The lock guards only O(1) LRU bookkeeping: the inflation
    // itself is a pure function of immutable chunk bytes, so it runs outside
    // the lock and each pasuk's Lazy shares a single inflation between its
    // concurrent misses — a fling's worth of commentary cells never
    // serializes behind the cache.
    private const int PasukCacheCapacity = 24;
    private readonly object _cacheLock = new();
    private readonly LinkedList<int> _lruPesukim = new();
    private readonly Dictionary<int, PasukSlice> _pasukCache = new();

    // A perek blob is one zlib stream, so it cannot seek: the old per-pasuk
    // decode re-inflated the whole buffer for every missed pasuk (~2.9MB of
    // raw text per scan on a dense perek — #2310). On the first miss one
    // pass re-chunks the records into per-pasuk compressed slices, so a miss
    // then inflates only its own pasuk's records — a few percent of the
    // perek instead of all of it. Once the split lands the shared blob is
    // released, keeping the chapter's retained memory at roughly one
    // compressed copy of the notes. The Lazy shares the split between a
    // fling's concurrent misses; a faulted split is swapped for a fresh Lazy
    // so the next miss retries instead of rethrowing the cached failure.
    private Lazy<Dictionary<int, byte[]>> _pasukChunks;
    private byte[]? _blob;
    private int _decodeScans;
    private int _fullScans;

    private sealed class PasukSlice(LinkedListNode<int> node, Func<Dictionary<int, List<string>>> decode)
    {
        internal LinkedListNode<int> Node { get; } = node;
        internal Lazy<Dictionary<int, List<string>>> Notes { get; } =
            new(decode, LazyThreadSafetyMode.ExecutionAndPublication);
    }

    /// <summary>Per-pasuk chunk inflations — diagnostics and tests watch this stay low.</summary>
    internal int DecodeScans => _decodeScans;

    /// <summary>Whole-blob decompress passes (construction headers plus
    /// splits) — bounded by the chapter's lifetime, not by scroll distance.</summary>
    internal int FullScans => _fullScans;

    internal PerushNoteChapter(byte[] blob)
    {
        _blob = blob;
        _pasukChunks = NewPasukChunks();
        _perushIdsByPasuk = PerushNoteBlob.ReadHeaders(blob)
            .GroupBy(h => h.Pasuk)
            .ToDictionary(g => g.Key, g => g.Select(h => h.PerushId).Distinct().ToList());
        Interlocked.Increment(ref _fullScans);
        PerushIds = [.. _perushIdsByPasuk.Values.SelectMany(ids => ids).Distinct().Order()];
    }

    /// <summary>Distinct perush ids with notes anywhere in the perek, ascending.</summary>
    internal IReadOnlyList<int> PerushIds { get; }

    internal IEnumerable<int> AvailablePerushIds(int firstPasuk, int lastPasuk) =>
        _perushIdsByPasuk.Where(p => p.Key >= firstPasuk && p.Key <= lastPasuk)
            .SelectMany(p => p.Value).Distinct();

    private Lazy<Dictionary<int, byte[]>> NewPasukChunks() =>
        new(SplitIntoPasukChunks, LazyThreadSafetyMode.ExecutionAndPublication);

    /// <summary>The one whole-blob scan a scroll ever needs: rewrites the
    /// compressed records into per-pasuk chunks, then releases the blob.</summary>
    private Dictionary<int, byte[]> SplitIntoPasukChunks()
    {
        // The factory runs once while the blob is still held: a successful
        // split releases it below, and a faulted one is swapped for a fresh
        // Lazy — _blob is never null here.
        // Fastest deflate: the chunks exist to bound memory, and a single-pasuk
        // slice loses little ratio. This pass runs inside the first scroll
        // miss, so it stays off the slowest setting.
        var chunks = PerushNoteBlob.SplitByPasuk(_blob!, CompressionLevel.Fastest);
        _blob = null;
        Interlocked.Increment(ref _fullScans);
        return chunks;
    }

    private List<string> NotesFor(int pasuk, int perushId)
    {
        PasukSlice slice;
        Lazy<Dictionary<int, byte[]>> chunks;
        lock (_cacheLock)
        {
            chunks = _pasukChunks;
            if (_pasukCache.TryGetValue(pasuk, out var cached))
            {
                _lruPesukim.Remove(cached.Node);
                _lruPesukim.AddFirst(cached.Node);
                slice = cached;
            }
            else
            {
                slice = new PasukSlice(_lruPesukim.AddFirst(pasuk), () => DecodePasuk(chunks, pasuk));
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
        catch //NOSONAR — the failure rethrows; the handler only evicts the pasuk's slice so retries rescan.
        {
            // A failed decode must not stay cached: evict the pasuk so the
            // next caller retries (e.g. a transient OOM under scroll
            // pressure). A failed split stays faulted inside the shared Lazy,
            // so swap it in the same breath — otherwise every later miss
            // rethrows that one cached failure forever.
            lock (_cacheLock)
            {
                _pasukCache.Remove(pasuk);
                _lruPesukim.Remove(pasuk);
                if (ReferenceEquals(_pasukChunks, chunks) && !chunks.IsValueCreated)
                {
                    _pasukChunks = NewPasukChunks();
                }
            }
            throw;
        }
    }

    /// <summary>One chunk inflation for a single pasuk; the Lazy shares it between concurrent misses.</summary>
    private Dictionary<int, List<string>> DecodePasuk(Lazy<Dictionary<int, byte[]>> chunks, int pasuk)
    {
        var notes = chunks.Value.TryGetValue(pasuk, out var chunk)
            ? PerushNoteBlob.Decode(chunk)
            : [];
        var grouped = notes
            .GroupBy(n => n.PerushId)
            .ToDictionary(g => g.Key,
                g => g.OrderBy(n => n.NoteIdx).Select(n => n.Content).ToList());
        Interlocked.Increment(ref _decodeScans);
        return grouped;
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
