# Evidence — #2623 Taamey D as the native pasuk font

Native-app captures proving the bundled Taamey D face actually renders on
the **pasuk text** — the same face the website reader adopted in #2011 —
instead of the rounded system fallback that shipped before, while the
pasuk-number letter keeps the app's main face (reader chrome, not
scripture).

Captures are Android emulator frames (Pixel-class, 1080x2400). The
before shot is the master build; the after shots are this branch, both
installed offline (airplane-mode-safe: the font travels inside the APK
`assets/` via the `MauiFont` item group, so a clean install needs no
download). The website row was captured from the production reader at
the same perek (מלכים א טו, `/929/302`).

## What each file shows

| File | Surface | Content |
| --- | --- | --- |
| `before-perek.png` | Perek reader — מלכים א טו | System fallback face: rounded, uniform strokes, no taamim-aware glyph design. |
| `after-perek.png` | Perek reader — מלכים א טו | Same pesukim in Taamey D: the traditional serifed taamim face, matching the website reader — while the pasuk letter stays on the app's main face. |
| `after-tikkun.png` | תיקון קוראים flow | The canvas-drawn surface (`GraphicsView` + `ICanvas.DrawString`) in the same face — proof the platform-specific canvas resolution (Android asset filename) resolves the bundled typeface, not a fallback. |
| `font-compare.png` | composite | Top: the same first line of מלכים א טו right-aligned — master fallback, this branch, and the website reader — showing identical Taamey D glyph shapes after the fix. Bottom: the pasuk letter zoomed — master / first-round build / this fix — showing it returned to the app's main face (the first round had wrongly rendered it in Taamey D). |

## Why the first attempt showed no text change

The first round set `PasukTextLabel.FontFamily = TaameyD` and left every
span to inherit it — except `PasukMarkerTextConverter` **clones** the
pasuk's spans to prepend the pasuk-number marker, and the clone
unconditionally assigned `FontFamily = span.FontFamily`. Setting `null`
on the clone still marks the bindable property as locally set, so MAUI's
platform span-builder resolved the *system* face for the cloned text
instead of inheriting the label's Taamey D. Net effect on screenshots:
only the marker letter changed face — exactly what the review flagged.

The fix clones font properties only when the source span actually set
them (`Span.IsSet`), so pasuk text inherits the label face again, and
pins the marker span to `OpenSansRegular` (the app's main face) so it
never inherits Taamey D — matching the website, where the pasuk-number
element uses `font-family: inherit` rather than the scripture face.

## How the font gets where it shows

- `app/BibleOnSite/Resources/Fonts/TaameyD-Regular.ttf` — bundled face
  (license beside it in `TaameyD-license.txt`), swept into the APK/IPA/
  MSIX by the existing `MauiFont Include="Resources\Fonts\*.ttf;*.otf"` glob.
- `MauiProgram` registers the alias `TaameyD` → `ScriptureFonts.Family`.
- `ScriptureFonts` (`app/BibleOnSite/Helpers/ScriptureFonts.cs`) is the
  single contract: labels resolve through the registrar alias; the
  canvas resolves the per-platform spell (Android asset name, iOS
  PostScript `Taamey_D`, Windows `ms-appx:///`/`file:///` + `#Taamey D`).
- Consumers: `PasukTextLabel` (perek, parasha, masora, focused pasuk,
  Tanahpedia verse citations, שניים מקרא rows) and `TikkunFlowView`
  (תיקון קוראים measure + draw, faux-bold double-strike for pasuk
  markers where the canvas drops `IFont.Weight`).

## Regression coverage

`app/BibleOnSite.Tests/Resources/ScriptureFontTests.cs` pins the TTF's
identity (sfnt magic, family name `Taamey D` in the name table), license
presence, the csproj packaging glob, the `MauiProgram` registration and
the shared contract; control tests pin the label default and span
inheritance on every reader surface listed above, and the converter
tests pin that cloned pasuk spans keep an unset `FontFamily` (inheriting
the label face) while the marker span is pinned to `OpenSansRegular`.
