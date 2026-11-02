using System.Text;
using System.Xml.Linq;
using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Resources;

/// <summary>
/// Native scripture-font regression (#2623): the pasuk face is Taamey D, the
/// same family the website reader ships (#2011). These guards pin the whole
/// packaging-to-renderer path — the bundled TTF and its license, the registrar
/// alias in MauiProgram, the shared <see cref="Controls.PasukTextLabel"/>
/// contract on every reader's pasuk text, and the focused overlay sharing the
/// same control — so a dropped file, a renamed alias or a reverted view cannot
/// silently fall back to the UI font.
/// </summary>
public class ScriptureFontTests
{
    private static readonly string AppRoot = FindAppRoot();

    [Fact]
    public void BundledFont_IsAValidTaameyDTrueTypeFile()
    {
        var path = Path.Join(AppRoot, "Resources", "Fonts", "TaameyD-Regular.ttf");
        Assert.True(File.Exists(path), "TaameyD-Regular.ttf must be bundled in Resources/Fonts");

        var bytes = File.ReadAllBytes(path);
        // TrueType sfnt magic, not a web-only WOFF/WOFF2 (#2623 requires a
        // native font the platforms can actually load).
        Assert.Equal(new byte[] { 0x00, 0x01, 0x00, 0x00 }, bytes.Take(4).ToArray());
        Assert.True(bytes.Length > 10_000, "a real font face, not a stub");

        // The 'name' table carries UTF-16BE (Windows) and/or single-byte
        // (Macintosh) records — the family name must be Taamey D so platforms
        // resolving the internal family never fall back.
        var utf16 = Encoding.BigEndianUnicode.GetBytes("Taamey D");
        var latin1 = Encoding.Latin1.GetBytes("Taamey D");
        Assert.True(ContainsSubsequence(bytes, utf16) || ContainsSubsequence(bytes, latin1),
            "the bundled TTF must be the Taamey D family");
    }

    [Fact]
    public void License_TravelsWithTheFont()
    {
        var path = Path.Join(AppRoot, "Resources", "Fonts", "TaameyD-license.txt");
        Assert.True(File.Exists(path), "the GPL + font-exception license must ship beside the TTF");

        var license = File.ReadAllText(path);
        Assert.Contains("Taamey D", license);
        Assert.Contains("GNU Public License", license);

        // The MauiFont glob sweeps only TTF/OTF — the attribution must ride
        // into the package through its own MauiAsset so installed apps carry
        // the license, not just the source tree (#2623).
        var csproj = File.ReadAllText(Path.Join(AppRoot, "BibleOnSite.csproj"));
        Assert.Contains(
            "MauiAsset Include=\"Resources\\Fonts\\TaameyD-license.txt\"", csproj);
    }

    [Fact]
    public void Csproj_PackagesEveryBundledFont()
    {
        var csproj = File.ReadAllText(Path.Join(AppRoot, "BibleOnSite.csproj"));
        Assert.Contains("Resources\\Fonts\\*.ttf", csproj);
    }

    [Fact]
    public void MauiProgram_RegistersTheScriptureFontAlias()
    {
        var mauiProgram = File.ReadAllText(Path.Join(AppRoot, "MauiProgram.cs"));
        // The file name and the shared alias must be wired together — a
        // literal alias here could drift from ScriptureFonts.Family.
        Assert.Contains("fonts.AddFont(\"TaameyD-Regular.ttf\", ScriptureFonts.Family)", mauiProgram);
    }

    [Fact]
    public void ScriptureFonts_HoldsTheSharedContract()
    {
        Assert.Equal("TaameyD", ScriptureFonts.Family);
        // Regular and Bold share one face — Bold only adds the weight flag a
        // canvas can honor (Windows); on the net10.0 test target the canvas
        // name is the alias itself.
        Assert.Equal(ScriptureFonts.Regular.Name, ScriptureFonts.Bold.Name);
        Assert.Equal(Microsoft.Maui.Graphics.FontWeights.Bold, ScriptureFonts.Bold.Weight);
    }

    [Fact]
    public void CanvasFonts_ResolvePerPlatform_NotThroughTheAlias()
    {
        var src = File.ReadAllText(Path.Join(AppRoot, "Helpers", "ScriptureFonts.cs"));
        // GraphicsView canvases bypass the font registrar — pin each platform's
        // lookup spell: Android asset filename, iOS PostScript name, Windows
        // uri#family (packaged + unpackaged).
        Assert.Contains("TaameyD-Regular.ttf", src);
        Assert.Contains("Taamey_D", src);
        Assert.Contains("ms-appx:///", src);
        Assert.Contains("file:///", src);
    }

    [Theory]
    [InlineData("PerekPage.xaml")]
    [InlineData("ParashaPage.xaml")]
    [InlineData("MasoraPage.xaml")]
    public void Readers_RenderPesukimThroughTheSharedPasukLabel(string page)
    {
        var xaml = XDocument.Load(Path.Join(AppRoot, "Pages", page));
        var labels = xaml.Descendants()
            .Where(e => e.Name.LocalName == "PasukTextLabel" &&
                        e.Attribute("AutomationId")?.Value == "PasukText")
            .ToList();
        Assert.NotEmpty(labels);
    }

    [Fact]
    public void FocusedPasuk_UsesTheSharedPasukLabel_NotAPlainLabel()
    {
        var xaml = XDocument.Load(Path.Join(AppRoot, "Controls", "FocusedPasukOverlay.xaml"));
        var label = xaml.Descendants()
            .Single(e => e.Attribute("AutomationId")?.Value == "FocusedPasukText");
        Assert.Equal("PasukTextLabel", label.Name.LocalName);
    }

    [Fact]
    public void TanahpediaOccurrences_RenderVersesThroughTheSharedPasukLabel()
    {
        var xaml = XDocument.Load(Path.Join(AppRoot, "Pages", "TanahpediaEntryPage.xaml"));
        var label = xaml.Descendants()
            .Single(e => e.Attribute("FormattedText")?.Value == "{Binding VerseFormatted}");
        Assert.Equal("PasukTextLabel", label.Name.LocalName);
    }

    private static bool ContainsSubsequence(byte[] haystack, byte[] needle)
    {
        for (var i = 0; i + needle.Length <= haystack.Length; i++)
        {
            var match = true;
            for (var j = 0; j < needle.Length; j++)
            {
                if (haystack[i + j] != needle[j])
                {
                    match = false;
                    break;
                }
            }
            if (match)
            {
                return true;
            }
        }
        return false;
    }

    private static string FindAppRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null)
        {
            var candidate = Path.Join(dir, "BibleOnSite");
            if (Directory.Exists(candidate) && File.Exists(Path.Join(candidate, "BibleOnSite.csproj")))
            {
                return candidate;
            }

            var siblingCandidate = Path.Join(Path.GetDirectoryName(dir)!, "BibleOnSite");
            if (Directory.Exists(siblingCandidate) && File.Exists(Path.Join(siblingCandidate, "BibleOnSite.csproj")))
            {
                return siblingCandidate;
            }

            dir = Path.GetDirectoryName(dir);
        }

        throw new InvalidOperationException(
            "Could not locate BibleOnSite project root from " + AppContext.BaseDirectory);
    }
}
