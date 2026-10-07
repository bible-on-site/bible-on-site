using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;

namespace BibleOnSite.Models;

public sealed record RecitationWord(int Pasuk, int Segment, string Text, double? StartMs, double? EndMs);

public sealed record RecitationTrack(int PerekId, string AudioUrl, string AudioSha256, string TextSha256,
    double DurationMs, string AlignmentStatus, List<RecitationWord> Words)
{
    public bool Matches(IReadOnlyList<Pasuk> pasukim)
    {
        var canonical = pasukim.SelectMany(p => p.Segments.Select((s, i) => (p.PasukNum, Segment: i + 1, s.Type, s.Value)))
            .Where(s => s.Type == SegmentType.Qri && s.Value.Any(c => c >= 'א' && c <= 'ת'))
            .Select(s => new RecitationWord(s.PasukNum, s.Segment, s.Value, null, null)).ToList();
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(
            string.Join("\n", canonical.Select(w => $"{w.Pasuk}:{w.Segment}:{w.Text}")))));
        return hash == TextSha256 && (AlignmentStatus != "ready" || canonical.Select(w => (w.Pasuk, w.Segment, w.Text))
            .SequenceEqual(Words.Select(w => (w.Pasuk, w.Segment, w.Text))));
    }

    public void Validate()
    {
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

    private static bool IsHash(string? value) => value is { Length: 64 } && value.All(c => "0123456789abcdef".Contains(c));
}

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
    public string PackName => $"recitation_{SeferId}";
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
[JsonSerializable(typeof(RecitationExtensionCatalog))]
[JsonSerializable(typeof(string))]
[JsonSerializable(typeof(List<RecitationClipRange>), TypeInfoPropertyName = "ClipRanges")]
#pragma warning disable S2333 // System.Text.Json source generation supplies this partial implementation.
public partial class RecitationJsonContext : JsonSerializerContext;
#pragma warning restore S2333
