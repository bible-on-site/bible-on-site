using GraphicsFont = Microsoft.Maui.Graphics.Font;
using GraphicsFontWeights = Microsoft.Maui.Graphics.FontWeights;
using GraphicsFontStyleType = Microsoft.Maui.Graphics.FontStyleType;

namespace BibleOnSite.Helpers;

/// <summary>
/// The single scripture-font contract (#3685): Al Heperek — the brand face
/// that gained complete niqqud and taamim coverage in v0.9.5 — is the native
/// pasuk font everywhere the app renders verse glyphs: the perek, parasha and
/// masora readers (<see cref="Controls.PasukTextLabel"/>), the focused-pasuk
/// overlay, and the drawn presentations (תיקון קוראים, שניים מקרא). It shares
/// the brand registrar alias, so the packaged file, the registrar alias and
/// every consumer cannot drift apart. Taamey D — the previous scripture face
/// (#2623) — stays registered under <see cref="TaameyDFamily"/> as the bundled
/// alternative.
/// </summary>
public static class ScriptureFonts
{
    /// <summary>
    /// The <c>ConfigureFonts</c> alias for the bundled
    /// <c>AlHeperekUI-Regular.ttf</c> — what <see cref="Microsoft.Maui.Controls.Label.FontFamily"/>
    /// resolves through the font registrar.
    /// </summary>
    public static readonly string Family = "AlHeperekRegular";

    /// <summary>
    /// The <c>ConfigureFonts</c> alias for the bundled
    /// <c>TaameyD-Regular.ttf</c> — kept registered as the traditional taamim
    /// alternative (#3685).
    /// </summary>
    public static readonly string TaameyDFamily = "TaameyD";

    private const string FileName = "AlHeperekUI-Regular.ttf";
    private const string PostScriptName = "AlHeperekUI-Regular";
    private const string FamilyName = "Al Heperek Font UI";

    // Canvas fonts can't use the alias: a GraphicsView's ICanvas resolves
    // IFont.Name through the platform text stack, which never consults the
    // font registrar — each OS needs the spell its own loader honors:
    //   Android        Typeface.CreateFromAsset → the bundled asset filename
    //   iOS/Catalyst   CTFont/UIFont.FromName   → PostScript name (UIAppFonts)
    //   Windows        CanvasTextFormat.FontFamily → "<uri>#<family>"
    // The net11.0 fallback keeps unit tests pinned to the same contract; the
    // canvas is never painted there.
#if ANDROID
    private static readonly string CanvasName = FileName;
#elif IOS || MACCATALYST
    private static readonly string CanvasName = PostScriptName;
#elif WINDOWS
    private static readonly string CanvasName = ResolveWindowsCanvasName();
#else
    private static readonly string CanvasName = Family;
#endif

    /// <summary>
    /// Canvas font for drawn scripture text (תיקון קוראים flow). Labels never
    /// need this — their <see cref="Microsoft.Maui.Controls.Label.FontFamily"/>
    /// uses <see cref="Family"/> directly and spans inherit it.
    /// </summary>
    public static readonly GraphicsFont Regular = new(CanvasName);

    /// <summary>
    /// Bold canvas face for scripture markers (pasuk-number words in the
    /// תיקון קוראים flow). Only Windows honors the weight once a custom face
    /// resolves; elsewhere <see cref="Controls.TikkunFlowView"/> double-strikes
    /// marker words so they keep the emphasis the system font used to give.
    /// </summary>
    public static readonly GraphicsFont Bold =
        new(CanvasName, GraphicsFontWeights.Bold, GraphicsFontStyleType.Normal);

#if WINDOWS
    private static string ResolveWindowsCanvasName()
    {
        // CanvasTextFormat.FontFamily wants "<uri>#<family>". The bundled font
        // sits at the app root (ContentWithTargetPath emits the bare file
        // name): packaged apps resolve ms-appx:///, unpackaged builds need a
        // real file:/// URI — the same split MAUI's FontImageSourceService
        // applies to FontManager's output.
        const string suffix = "#" + FamilyName;
        if (Microsoft.Maui.ApplicationModel.AppInfo.PackagingModel
                == Microsoft.Maui.ApplicationModel.AppPackagingModel.Packaged)
        {
            return "ms-appx:///" + FileName + suffix;
        }
        var fileUri = new System.Uri(Path.Combine(AppContext.BaseDirectory, FileName));
        return fileUri.AbsoluteUri + suffix;
    }
#endif
}
