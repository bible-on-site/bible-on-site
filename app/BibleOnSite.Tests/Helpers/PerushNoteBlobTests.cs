using System.IO.Compression;
using System.Text;
using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class PerushNoteBlobTests
{
    /// <summary>Zlib-compresses a hand-built uncompressed payload so malformed
    /// record tests exercise the real decode path (mirrors the Rust fixture).</summary>
    private static byte[] Compress(byte[] raw)
    {
        using var output = new MemoryStream();
        using (var zlib = new ZLibStream(output, CompressionLevel.SmallestSize, leaveOpen: true))
        {
            zlib.Write(raw, 0, raw.Length);
        }
        return output.ToArray();
    }

    private static byte[] RawBlob(Action<BinaryWriter> fill)
    {
        using var raw = new MemoryStream();
        using (var writer = new BinaryWriter(raw, Encoding.UTF8, leaveOpen: true))
        {
            fill(writer);
        }
        return Compress(raw.ToArray());
    }

    [Fact]
    public void Decode_RoundTripsEncodedNotes()
    {
        List<PerushNoteBlob.Note> notes =
        [
            new(1, 1, 0, "בראשית - בשביל התורה"),
            new(2, 1, 0, "בראשית ברא - <b>הפועל</b>"),
            new(1, 2, 0, "והארץ היתה תהו"),
            new(1, 2, 1, "second index on same pasuk"),
        ];

        var decoded = PerushNoteBlob.Decode(PerushNoteBlob.Encode(notes));

        decoded.Should().Equal(notes);
    }

    [Fact]
    public void Decode_EmptyBlobDecodesToEmptyList()
    {
        var decoded = PerushNoteBlob.Decode(PerushNoteBlob.Encode([]));

        decoded.Should().BeEmpty();
    }

    [Fact]
    public void Decode_GarbageThatIsNotZlib_Throws()
    {
        var act = () => PerushNoteBlob.Decode([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

        act.Should().Throw<InvalidDataException>();
    }

    [Fact]
    public void Decode_WrongMagicInValidZlib_Throws()
    {
        var blob = RawBlob(writer =>
        {
            writer.Write("PNB2"u8.ToArray());
            writer.Write(0u);
        });

        var act = () => PerushNoteBlob.Decode(blob);

        act.Should().Throw<InvalidDataException>().WithMessage("*magic*");
    }

    [Fact]
    public void Decode_ShortMagic_Throws()
    {
        var blob = Compress("PN"u8.ToArray());

        var act = () => PerushNoteBlob.Decode(blob);

        act.Should().Throw<InvalidDataException>().WithMessage("*magic*");
    }

    [Fact]
    public void Decode_TruncatedRecordHeader_Throws()
    {
        var blob = RawBlob(writer =>
        {
            writer.Write("PNB1"u8.ToArray());
            writer.Write(1u); // one record claimed…
            writer.Write((short)7); // …but only two bytes of it arrive
        });

        var act = () => PerushNoteBlob.Decode(blob);

        act.Should().Throw<EndOfStreamException>();
    }

    [Fact]
    public void Decode_ImplausiblyLargeContent_Throws()
    {
        var blob = RawBlob(writer =>
        {
            writer.Write("PNB1"u8.ToArray());
            writer.Write(1u);
            writer.Write(7u); // perush
            writer.Write(3u); // pasuk
            writer.Write(0u); // noteIdx
            writer.Write(uint.MaxValue); // declared length beyond the cap
        });

        var act = () => PerushNoteBlob.Decode(blob);

        act.Should().Throw<InvalidDataException>().WithMessage("*implausibly large*");
    }

    [Fact]
    public void Decode_ContentShorterThanDeclaredLength_Throws()
    {
        var blob = RawBlob(writer =>
        {
            writer.Write("PNB1"u8.ToArray());
            writer.Write(1u);
            writer.Write(7u);
            writer.Write(3u);
            writer.Write(0u);
            writer.Write(100u); // declares 100 bytes…
            writer.Write("abc"u8.ToArray()); // …but only 3 follow
        });

        var act = () => PerushNoteBlob.Decode(blob);

        act.Should().Throw<EndOfStreamException>().WithMessage("*truncated*");
    }

    [Fact]
    public void Decode_TruncatedZlibStream_Throws()
    {
        var full = PerushNoteBlob.Encode([new PerushNoteBlob.Note(1, 1, 0, "abcdef")]);
        var truncated = full[..(full.Length / 2)];

        var act = () => PerushNoteBlob.Decode(truncated);

        act.Should().Throw<Exception>();
    }

    [Fact]
    public void Decode_InvalidUtf8Content_ProducesReplacementText_NotThrow()
    {
        // UTF-8 GetString replaces malformed sequences — the reader intentionally
        // tolerates them rather than dropping the perek's notes.
        var blob = RawBlob(writer =>
        {
            writer.Write("PNB1"u8.ToArray());
            writer.Write(1u);
            writer.Write(7u);
            writer.Write(3u);
            writer.Write(0u);
            var content = new byte[] { 0x61, 0xFF, 0x62 };
            writer.Write(content.Length);
            writer.Write(content);
        });

        var decoded = PerushNoteBlob.Decode(blob);

        decoded.Should().HaveCount(1);
        decoded[0].Content.Should().Be("a\uFFFDb");
    }

    [Fact]
    public void ReadHeaders_BadMagic_Throws()
    {
        var blob = RawBlob(writer =>
        {
            writer.Write("BAD!"u8.ToArray());
            writer.Write(0u);
        });

        var act = () => PerushNoteBlob.ReadHeaders(blob);

        act.Should().Throw<InvalidDataException>().WithMessage("*bad magic*");
    }

    [Fact]
    public void ReadHeaders_ImplausiblyLargeRecord_Throws()
    {
        var blob = RawBlob(writer =>
        {
            writer.Write("PNB1"u8.ToArray());
            writer.Write(1u);
            writer.Write(7u);
            writer.Write(3u);
            writer.Write(0u);
            writer.Write(uint.MaxValue); // declared length exceeds MaxContentBytes
        });

        var act = () => PerushNoteBlob.ReadHeaders(blob);

        act.Should().Throw<InvalidDataException>().WithMessage("*implausibly large*");
    }
}
