namespace BibleOnSite.Helpers;

/// <summary>Self-contained typography for the offline article WebView.</summary>
public static class BrandFonts
{
    private static readonly Lazy<string> Css = new(() =>
        FontFace("Regular", 400) + FontFace("SemiBold", 600) + FontFace("Bold", 700));

    public static string WebViewCss => Css.Value;

    private static string FontFace(string style, int weight)
    {
        using var stream = typeof(BrandFonts).Assembly.GetManifestResourceStream($"AlHeperekUI-{style}.ttf")
            ?? throw new InvalidOperationException($"The bundled Al Heperek {style} font is missing.");
        using var bytes = new MemoryStream();
        stream.CopyTo(bytes);
        return $"@font-face{{font-family:'Al Heperek Font UI';font-style:normal;font-weight:{weight};src:url(data:font/ttf;base64,{Convert.ToBase64String(bytes.ToArray())}) format('truetype');}}";
    }
}
