using System.Collections.Concurrent;
using System.Text;
using System.Threading;

namespace AltCover.Recorder
{
    // Every instrumented line calls Visit. Updating a dictionary value takes a
    // stripe lock even after the point is known; fixed-size blocks instead keep
    // the hot path to two lookups and an atomic increment. Blocks are allocated
    // only for visited ranges, so sparse IDs do not allocate an enormous array.
    internal sealed class VisitCounters
    {
        private const int BlockShift = 10;
        private const int BlockSize = 1 << BlockShift;
        private ConcurrentDictionary<string, ConcurrentDictionary<int, long[]>> _modules = new();

        public void Visit(string moduleId, int pointId)
        {
            var modules = Volatile.Read(ref _modules);
            var blocks = modules.GetOrAdd(moduleId, static _ => new ConcurrentDictionary<int, long[]>());
            // Signed shifts keep sequence IDs and int.MinValue + branch IDs in
            // separate blocks while retaining their exact original keys.
            var counters = blocks.GetOrAdd(pointId >> BlockShift, static _ => new long[BlockSize]);
            Interlocked.Increment(ref counters[pointId & (BlockSize - 1)]);
        }

        public void Reset()
        {
            // A read-only scenario may add no visits after reset. Retain the
            // observed build identities so its empty counters remain a valid
            // dump; replace every block so prior-test hits cannot leak through.
            var cleared = new ConcurrentDictionary<string, ConcurrentDictionary<int, long[]>>();
            foreach (var moduleId in Volatile.Read(ref _modules).Keys)
            {
                cleared[moduleId] = new ConcurrentDictionary<int, long[]>();
            }
            Interlocked.Exchange(ref _modules, cleared);
        }

        public string SnapshotJson()
        {
            var modules = Volatile.Read(ref _modules);
            var builder = new StringBuilder(modules.Count * 256);
            builder.Append("{\"format\":\"altcover-visits/1\",\"modules\":{");
            var firstModule = true;
            foreach (var module in modules)
            {
                if (!firstModule) { builder.Append(','); }
                firstModule = false;
                builder.Append('\"').Append(module.Key).Append("\":{");
                var firstPoint = true;
                foreach (var block in module.Value)
                {
                    for (var offset = 0; offset < BlockSize; offset++)
                    {
                        var count = Interlocked.Read(ref block.Value[offset]);
                        if (count == 0) { continue; }
                        if (!firstPoint) { builder.Append(','); }
                        firstPoint = false;
                        var pointId = (block.Key << BlockShift) + offset;
                        builder.Append('\"').Append(pointId).Append("\":").Append(count);
                    }
                }
                builder.Append('}');
            }
            return builder.Append("}}").ToString();
        }
    }
}
