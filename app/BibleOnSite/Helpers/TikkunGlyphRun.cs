using System.Security.Cryptography;
using System.Text.Json;
using HarfBuzzSharp;
using Microsoft.Maui.Graphics;
using HbBuffer = HarfBuzzSharp.Buffer;
using HbFont = HarfBuzzSharp.Font;

namespace BibleOnSite.Helpers;

/// <summary>
/// A complete marked word shaped once in the bundled scripture font. Both
/// layers use those same glyph origins and advances. Marks inside composite
/// glyphs (dagesh, shin/sin dots) are separate contours too: hiding annotations
/// never substitutes a different letter glyph or shapes a stripped string.
/// </summary>
internal sealed record TikkunGlyphRun(
    float Width, float Ascent, float Descent, PathF Bases, PathF Marks,
    IReadOnlyList<TikkunGlyph> Glyphs);

internal sealed record TikkunGlyph(string Name, uint Cluster, float X, float Y, float Advance);

internal static class TikkunFont
{
    private static readonly Lazy<TikkunFontData> Reference = new(LoadReference);

    private static TikkunFontData LoadReference()
    {
        var assembly = typeof(TikkunFont).Assembly;
        using var font = assembly.GetManifestResourceStream("TikkunFont.ttf")!;
        using var outlines = assembly.GetManifestResourceStream("TikkunFont.outlines.json")!;
        return Load(font, outlines);
    }

    internal static TikkunFontData Load(Stream font, Stream outlines)
    {
        using var bytes = new MemoryStream();
        font.CopyTo(bytes);
        var fontBytes = bytes.ToArray();
        using var document = JsonDocument.Parse(outlines);
        var root = document.RootElement;
        var fontHash = root.GetProperty("FontSha256").GetString()!;
        if (!string.Equals(Convert.ToHexString(SHA256.HashData(fontBytes)),
            fontHash, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("Regenerate TaameyD-outlines.json for the packaged scripture font.");
        }
        // The asset has a fixed schema. Explicit parsing avoids reflection
        // in trimmed apps and needs no generated serialization declaration.
        return new TikkunFontData(fontHash,
            root.GetProperty("UnitsPerEm").GetInt32(),
            root.GetProperty("Ascent").GetInt32(),
            root.GetProperty("Descent").GetInt32(),
            root.GetProperty("Glyphs").EnumerateArray().Select(glyph =>
                new TikkunGlyphOutline(glyph.GetProperty("Name").GetString()!,
                    ReadCommands(glyph, "Base"), ReadCommands(glyph, "Marks"))).ToArray(),
            fontBytes);
    }

    private static float[] ReadCommands(JsonElement glyph, string layer) =>
        glyph.GetProperty(layer).EnumerateArray().Select(value => value.GetSingle()).ToArray();

    public static TikkunGlyphRun Shape(string markedText, float fontSize)
    {
        var data = Reference.Value;
        // Each shape owns its native handles; cached runs contain managed
        // paths only. A recycled reader never retains native font resources.
        using var stream = new MemoryStream(data.FontBytes, writable: false);
        using var blob = Blob.FromStream(stream);
        using var face = new Face(blob, 0);
        using var font = new HbFont(face);
        font.SetFunctionsOpenType();
        font.SetScale(data.UnitsPerEm, data.UnitsPerEm);
        using var buffer = new HbBuffer();
        buffer.AddUtf16(markedText);
        buffer.GuessSegmentProperties();
        font.Shape(buffer);

        var scale = fontSize / data.UnitsPerEm;
        var bases = new PathF();
        var marks = new PathF();
        var glyphs = new List<TikkunGlyph>();
        var infos = buffer.GetGlyphInfoSpan();
        var positions = buffer.GetGlyphPositionSpan();
        var advance = 0;
        for (var i = 0; i < infos.Length; i++)
        {
            var outline = data.Glyphs[infos[i].Codepoint];
            var position = positions[i];
            var x = (advance + position.XOffset) * scale;
            var y = -position.YOffset * scale;
            Append(bases, outline.Base, x, y, scale);
            Append(marks, outline.Marks, x, y, scale);
            glyphs.Add(new TikkunGlyph(outline.Name, infos[i].Cluster, x, y, position.XAdvance * scale));
            advance += position.XAdvance;
        }
        return new TikkunGlyphRun(advance * scale, data.Ascent * scale, data.Descent * scale,
            bases, marks, glyphs);
    }

    internal static void Append(PathF path, float[] commands, float x, float y, float scale)
    {
        var i = 0;
        float X() => x + commands[i++] * scale;
        float Y() => y - commands[i++] * scale;
        while (i < commands.Length)
        {
            switch ((int)commands[i++])
            {
                case 0:
                    path.MoveTo(X(), Y());
                    break;
                case 1:
                    path.LineTo(X(), Y());
                    break;
                case 2:
                    path.QuadTo(X(), Y(), X(), Y());
                    break;
                case 3:
                    path.CurveTo(X(), Y(), X(), Y(), X(), Y());
                    break;
                case 4:
                    path.Close();
                    break;
                default:
                    throw new InvalidDataException("Invalid scripture glyph contour command.");
            }
        }
    }
}

internal sealed record TikkunFontData(string FontSha256, int UnitsPerEm, int Ascent,
    int Descent, TikkunGlyphOutline[] Glyphs, byte[] FontBytes);

internal sealed record TikkunGlyphOutline(string Name, float[] Base, float[] Marks);
