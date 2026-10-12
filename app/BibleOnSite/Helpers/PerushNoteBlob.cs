using System.IO.Compression;
using System.Text;

namespace BibleOnSite.Helpers;

/// <summary>
/// The "PNB1" per-perek commentary blob — the storage unit of the v2
/// perushim notes database. One `note_blob.data` row carries every note of a
/// single perek, little-endian records zlib-compressed as one buffer:
/// "PNB1" | u32 count | records{ u32 perushId, u32 pasuk, u32 noteIdx, u32 len, utf8 content }.
/// Written by data/sefaria/pipelines/perushim-view (note_blob.rs); keep the
/// layout in sync with that file.
/// </summary>
internal static class PerushNoteBlob
{
    /// <summary>Value of the `_metadata.schema_version` key this reader expects.</summary>
    internal const string SchemaVersion = "2";

    private static ReadOnlySpan<byte> Magic => "PNB1"u8;

    /// <summary>A note cannot exceed this size; real content peaks near 71 KB.</summary>
    private const int MaxContentBytes = 64 * 1024 * 1024;

    internal readonly record struct Note(int PerushId, int Pasuk, int NoteIdx, string Content);

    internal static List<Note> Decode(byte[] blob, Func<int, int, bool>? include = null)
    {
        using var stream = new ZLibStream(new MemoryStream(blob, writable: false), CompressionMode.Decompress);
        using var reader = new BinaryReader(stream, Encoding.UTF8);
        var magic = reader.ReadBytes(4);
        if (magic.Length != 4 || !magic.AsSpan().SequenceEqual(Magic))
        {
            throw new InvalidDataException("Perushim note blob has a bad magic.");
        }

        var count = reader.ReadUInt32();
        var notes = new List<Note>((int)Math.Min(count, 1 << 20));
        Span<byte> skipBuffer = stackalloc byte[4096];
        for (var i = 0; i < count; i++)
        {
            var perushId = reader.ReadUInt32();
            var pasuk = reader.ReadUInt32();
            var noteIdx = reader.ReadUInt32();
            var len = reader.ReadUInt32();
            if (len > MaxContentBytes)
            {
                throw new InvalidDataException("Perushim note blob record is implausibly large.");
            }
            if (include != null && !include((int)perushId, (int)pasuk))
            {
                SkipContent(stream, len, skipBuffer);
                continue;
            }
            var content = reader.ReadBytes((int)len);
            if (content.Length != len)
            {
                throw new EndOfStreamException("Perushim note blob is truncated.");
            }
            notes.Add(new Note((int)perushId, (int)pasuk, (int)noteIdx, Encoding.UTF8.GetString(content)));
        }
        return notes;
    }

    internal readonly record struct Header(int PerushId, int Pasuk, int NoteIdx, int ContentBytes);

    /// <summary>Read identities without materializing any commentary text.</summary>
    internal static List<Header> ReadHeaders(byte[] blob)
    {
        using var stream = new ZLibStream(new MemoryStream(blob, writable: false), CompressionMode.Decompress);
        using var reader = new BinaryReader(stream, Encoding.UTF8);
        var magic = reader.ReadBytes(4);
        if (magic.Length != 4 || !magic.AsSpan().SequenceEqual(Magic))
        {
            throw new InvalidDataException("Perushim note blob has a bad magic.");
        }
        var count = reader.ReadUInt32();
        var headers = new List<Header>((int)Math.Min(count, 1 << 20));
        Span<byte> skipBuffer = stackalloc byte[4096];
        for (var i = 0; i < count; i++)
        {
            var perushId = reader.ReadUInt32();
            var pasuk = reader.ReadUInt32();
            var noteIdx = reader.ReadUInt32();
            var length = reader.ReadUInt32();
            if (length > MaxContentBytes)
            {
                throw new InvalidDataException("Perushim note blob record is implausibly large.");
            }
            SkipContent(stream, length, skipBuffer);
            headers.Add(new Header((int)perushId, (int)pasuk, (int)noteIdx, (int)length));
        }
        return headers;
    }

    private static void SkipContent(Stream stream, uint length, Span<byte> buffer)
    {
        while (length > 0)
        {
            var size = (int)Math.Min(length, (uint)buffer.Length);
            stream.ReadExactly(buffer[..size]);
            length -= (uint)size;
        }
    }

    /// <summary>Encodes one perek's notes; used by tests to build v2 fixtures.</summary>
    internal static byte[] Encode(IReadOnlyCollection<Note> notes)
    {
        using var raw = new MemoryStream();
        using (var writer = new BinaryWriter(raw, Encoding.UTF8, leaveOpen: true))
        {
            writer.Write(Magic);
            writer.Write(notes.Count);
            foreach (var note in notes)
            {
                var content = Encoding.UTF8.GetBytes(note.Content);
                writer.Write(note.PerushId);
                writer.Write(note.Pasuk);
                writer.Write(note.NoteIdx);
                writer.Write(content.Length);
                writer.Write(content);
            }
        }

        raw.Position = 0;
        using var output = new MemoryStream();
        using (var zlib = new ZLibStream(output, CompressionLevel.SmallestSize, leaveOpen: true))
        {
            raw.CopyTo(zlib);
        }
        return output.ToArray();
    }
}
