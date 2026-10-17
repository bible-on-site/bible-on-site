namespace BibleOnSite.Helpers;

/// <summary>
/// A thread-safe LRU cache bounded by both entry count and total measured
/// size. Recycling-bound render data (e.g. built commentary spannables) is
/// cached across handler instances so identical content is built once per
/// process; evicting least-recently-used entries keeps the footprint bounded
/// even when a reader scrolls a whole sefer.
/// </summary>
public sealed class BoundedLruCache<TKey, TValue> where TKey : notnull
{
    private sealed class Entry(TKey key, TValue value, int size)
    {
        public readonly TKey Key = key;
        public readonly TValue Value = value;
        public readonly int Size = size;
    }

    private readonly int _maxEntries;
    private readonly int _maxTotalSize;
    private readonly Func<TValue, int> _measure;
    private readonly object _gate = new();
    private readonly Dictionary<TKey, LinkedListNode<Entry>> _map = new();
    private readonly LinkedList<Entry> _lru = new(); // most recent first
    private int _totalSize;

    /// <param name="measure">Approximate size of a value in the units
    /// <paramref name="maxTotalSize"/> is expressed in.</param>
    public BoundedLruCache(int maxEntries, int maxTotalSize, Func<TValue, int> measure)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxEntries);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxTotalSize);
        _measure = measure ?? throw new ArgumentNullException(nameof(measure));
        _maxEntries = maxEntries;
        _maxTotalSize = maxTotalSize;
    }

    public int Count
    {
        get { lock (_gate) { return _map.Count; } }
    }

    /// <summary>
    /// Returns the cached value for <paramref name="key"/>, or builds it with
    /// <paramref name="factory"/> and caches it. The factory runs outside the
    /// lock so a slow build never serializes lookups; when concurrent callers
    /// race the same key the winner's entry is cached and returned to all.
    /// Values larger than <c>maxTotalSize</c> are returned without caching.
    /// </summary>
    public TValue GetOrAdd(TKey key, Func<TValue> factory)
    {
        lock (_gate)
        {
            if (_map.TryGetValue(key, out var node))
            {
                _lru.Remove(node);
                _lru.AddFirst(node);
                return node.Value.Value;
            }
        }

        var created = factory();
        var size = _measure(created);
        if (size > _maxTotalSize)
        {
            return created;
        }
        lock (_gate)
        {
            if (_map.TryGetValue(key, out var raced))
            {
                _lru.Remove(raced);
                _lru.AddFirst(raced);
                return raced.Value.Value;
            }
            var entry = _lru.AddFirst(new Entry(key, created, size));
            _map[key] = entry;
            _totalSize += size;
            while (_map.Count > _maxEntries || _totalSize > _maxTotalSize)
            {
                var tail = _lru.Last!;
                _lru.RemoveLast();
                _map.Remove(tail.Value.Key);
                _totalSize -= tail.Value.Size;
            }
            return created;
        }
    }
}
