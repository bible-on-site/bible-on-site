using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;

namespace BibleOnSite.Models;

public sealed record RecitationWord(int Pasuk, int Segment, string Text, double? StartMs, double? EndMs);

public sealed record RecitationTrack(int PerekId, string AudioUrl, string AudioSha256, string TextSha256,
    double DurationMs, string AlignmentStatus, List<RecitationWord> Words)
{
    // AudioSha256 always identifies the unchanged MP3 used for alignment.
    public RecitationPlayback? Playback { get; init; }
    [JsonIgnore]
    public string PlaybackSha256 => Playback?.Sha256 ?? AudioSha256;
    [JsonIgnore]
    public string PlaybackFileName => PlaybackSha256 + (Playback == null ? ".mp3" : ".ogg");

    // The readers always pass PerekDataService's stored list, so the verdict is
    // memoized by reference. Words is part of the key because `with` clones copy
    // this cache while swapping Words.
    // shortcut: a pasukim list mutated in place keeps its cached verdict; pass a
    // new list instance when the content changes.
    private (IReadOnlyList<Pasuk> Pasukim, List<RecitationWord> Words, bool Result)? _matchCache;

    public bool Matches(IReadOnlyList<Pasuk> pasukim)
    {
        if (_matchCache is { } cached && ReferenceEquals(cached.Pasukim, pasukim) && ReferenceEquals(cached.Words, Words))
        {
            return cached.Result;
        }
        var canonical = pasukim.SelectMany(p => p.Segments.Select((s, i) => (p.PasukNum, Segment: i + 1, s.Type, s.Value)))
            .Where(s => s.Type == SegmentType.Qri && s.Value.Any(c => c >= 'א' && c <= 'ת'))
            .Select(s => new RecitationWord(s.PasukNum, s.Segment, s.Value, null, null)).ToList();
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(
            string.Join("\n", canonical.Select(w => $"{w.Pasuk}:{w.Segment}:{w.Text}")))));
        var result = hash == TextSha256 && (AlignmentStatus != "ready" || canonical.Select(w => (w.Pasuk, w.Segment, w.Text))
            .SequenceEqual(Words.Select(w => (w.Pasuk, w.Segment, w.Text))));
        _matchCache = (pasukim, Words, result);
        return result;
    }

    // Word indexes follow the track instance so `with` copies never share
    // an index built for a different Words list.
    private static readonly ConditionalWeakTable<RecitationTrack, RecitationWordIndex> _wordIndexes = new();
    private RecitationWordIndex WordIndex =>
        _wordIndexes.GetValue(this, static track => new RecitationWordIndex(track.Words));

    public RecitationWord? GetWord(int pasuk, int segment) => WordIndex.GetWord(pasuk, segment);

    public IReadOnlyList<RecitationWord> GetWords(int pasuk) => WordIndex.GetWords(pasuk);

    public IReadOnlyList<RecitationWord> GetWordsBetweenPasukim(int firstPasuk, int lastPasuk) =>
        WordIndex.GetWordsBetweenPasukim(firstPasuk, lastPasuk);

    public IReadOnlyList<(double Start, double End)> GetPasukRanges() => WordIndex.GetPasukRanges();

    public void Validate()
    {
        if (Playback != null && (Playback.Format != "ogg-opus" || !IsHash(Playback.Sha256) ||
            Playback.SizeBytes <= 0 || Playback.Bitrate != 24000 || Playback.SourceSha256 != AudioSha256))
        {
            throw new InvalidDataException("Invalid derived playback metadata.");
        }
        if (PerekId is < 1 or > 929 || !Uri.TryCreate(AudioUrl, UriKind.Absolute, out var url) ||
            url.Scheme is not ("https" or "http") || url.UserInfo.Length != 0 || url.Query.Length != 0 || url.Fragment.Length != 0 ||
            !url.AbsolutePath.EndsWith($"/recordings/{PerekId}_record.mp3", StringComparison.Ordinal) ||
            !IsHash(AudioSha256) || !IsHash(TextSha256) || Words == null ||
            !double.IsFinite(DurationMs) || DurationMs <= 0 || AlignmentStatus is not ("ready" or "pending" or "needs_review"))
        {
            throw new InvalidDataException("Invalid recording metadata.");
        }

        if (AlignmentStatus != "ready")
        {
            if (Words.Count != 0)
            {
                throw new InvalidDataException("Unapproved word intervals.");
            }

            return;
        }
        if (Words.Count == 0)
        {
            throw new InvalidDataException("Missing word intervals.");
        }

        double end = 0;
        var previous = (Pasuk: 0, Segment: 0);
        foreach (var word in Words)
        {
            var identity = (word.Pasuk, word.Segment);
            if (word.Pasuk < 1 || word.Segment < 1 || identity.CompareTo(previous) <= 0 || string.IsNullOrWhiteSpace(word.Text) ||
                word.StartMs is not double start || word.EndMs is not double stop ||
                !double.IsFinite(start) || !double.IsFinite(stop) || start < end || stop <= start || stop > DurationMs)
            {
                throw new InvalidDataException("Invalid or overlapping word intervals.");
            }

            previous = identity;
            end = stop;
        }
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(
            string.Join("\n", Words.Select(w => $"{w.Pasuk}:{w.Segment}:{w.Text}")))));
        if (hash != TextSha256)
        {
            throw new InvalidDataException("Changed canonical recording text.");
        }
    }

    private sealed class RecitationWordIndex
    {
        private readonly Dictionary<(int Pasuk, int Segment), RecitationWord> _words = [];
        private readonly Dictionary<int, RecitationWord[]> _pasukWords = [];
        private readonly int[] _pasukNumbers;

        public RecitationWordIndex(IReadOnlyList<RecitationWord> words)
        {
            var byPasuk = new Dictionary<int, List<RecitationWord>>();
            foreach (var word in words)
            {
                _words.TryAdd((word.Pasuk, word.Segment), word);
                if (!byPasuk.TryGetValue(word.Pasuk, out var pasukWords))
                {
                    byPasuk[word.Pasuk] = pasukWords = [];
                }
                pasukWords.Add(word);
            }
            _pasukNumbers = [.. byPasuk.Keys.Order()];
            _pasukWords = byPasuk.ToDictionary(pair => pair.Key, pair => pair.Value.ToArray());
        }

        public RecitationWord? GetWord(int pasuk, int segment) =>
            _words.GetValueOrDefault((pasuk, segment));

        public IReadOnlyList<RecitationWord> GetWords(int pasuk) =>
            _pasukWords.GetValueOrDefault(pasuk) ?? [];

        public IReadOnlyList<RecitationWord> GetWordsBetweenPasukim(int firstPasuk, int lastPasuk)
        {
            var words = new List<RecitationWord>();
            if (lastPasuk < firstPasuk)
            {
                return words;
            }
            foreach (var pasuk in _pasukNumbers)
            {
                if (pasuk < firstPasuk)
                {
                    continue;
                }
                if (pasuk > lastPasuk)
                {
                    break;
                }
                words.AddRange(_pasukWords[pasuk]);
            }
            return words;
        }

        public IReadOnlyList<(double Start, double End)> GetPasukRanges()
        {
            var ranges = new List<(double Start, double End)>(_pasukNumbers.Length);
            foreach (var pasuk in _pasukNumbers)
            {
                var words = _pasukWords[pasuk];
                ranges.Add((words[0].StartMs!.Value, words[^1].EndMs!.Value));
            }
            return ranges;
        }
    }

    private static bool IsHash(string? value) => value is { Length: 64 } && value.All(c => "0123456789abcdef".Contains(c));
}

public sealed record RecitationPlayback(string Format, string Sha256, long SizeBytes, int Bitrate, string SourceSha256);

public sealed record RecitationPackage(int Version, List<RecitationTrack> Tracks)
{
    public void Validate()
    {
        if (Version != 1 || Tracks is not { Count: > 0 } || Tracks.Select(t => t.PerekId).Distinct().Count() != Tracks.Count)
        {
            throw new InvalidDataException("Unsupported recitation extension.");
        }

        foreach (var track in Tracks)
        {
            track.Validate();
        }
    }
}

public sealed record RecitationClipRange(double Start, double End);

// The small catalog ships with the app. Audio travels exclusively in store-delivered book packs.
public sealed record RecitationBookPack(int SeferId, string Sha256, long SizeBytes, List<int> PerekIds)
{
#if IOS || MACCATALYST
    // App Store Connect accepts only alphanumerics and hyphens in asset-pack IDs.
    public string PackName => $"recitation-{SeferId}";
#else
    // Play asset-pack names take underscores (hyphens are rejected).
    public string PackName => $"recitation_{SeferId}";
#endif
    public string FileName => PackName + ".zip";
}

public sealed record RecitationExtensionCatalog(int Version, RecitationPackage Package, List<RecitationBookPack> Books)
{
    public static string FileName => "recitation-catalog.json";

    public void Validate()
    {
        if (Version != 1 || Package == null || Books is not { Count: > 0 })
        {
            throw new InvalidDataException("Missing recitation book packages.");
        }
        Package.Validate();
        if (Books.Any(b => b == null || b.PerekIds is not { Count: > 0 } || b.SeferId is < 1 or > 39 ||
                b.SizeBytes is <= 0 or > 512_000_000 || b.Sha256 is not { Length: 64 } ||
                b.Sha256.Any(c => !"0123456789abcdef".Contains(c))))
        {
            throw new InvalidDataException("Invalid recitation book packages.");
        }
        var ids = Books.SelectMany(b => b.PerekIds).ToList();
        if (Books.Select(b => b.SeferId).Distinct().Count() != Books.Count ||
            ids.Count != ids.Distinct().Count() || !ids.Order().SequenceEqual(Package.Tracks.Select(t => t.PerekId).Order()))
        {
            throw new InvalidDataException("Invalid recitation book packages.");
        }
    }
}

// Native release builds trim reflection metadata. Keep the extension wire format explicit.
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(RecitationPackage))]
[JsonSerializable(typeof(RecitationTrack))]
[JsonSerializable(typeof(RecitationPlayback))]
[JsonSerializable(typeof(RecitationExtensionCatalog))]
[JsonSerializable(typeof(string))]
[JsonSerializable(typeof(List<RecitationClipRange>), TypeInfoPropertyName = "ClipRanges")]
#pragma warning disable S2333 // System.Text.Json source generation supplies this partial implementation.
public partial class RecitationJsonContext : JsonSerializerContext;
#pragma warning restore S2333
