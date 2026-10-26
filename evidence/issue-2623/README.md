# Evidence — #2623 Taamey D as the native pasuk font

Native-app captures proving the bundled Taamey D face actually renders —
the same face the website reader adopted in #2011 — instead of the
rounded system fallback that shipped before.

Captures are Android emulator frames (Pixel-class, 1080x2400). The
before shot is the master build; the after shots are this branch, both
installed offline (airplane-mode-safe: the font travels inside the APK
`assets/` via the `MauiFont` item group, so a clean install needs no
download).

## What each file shows

| File | Surface | Content |
| --- | --- | --- |
| `before-perek.png` | Perek reader — מלכים א טו | System fallback face: rounded, uniform strokes, no taamim-aware glyph design. |
| `after-perek.png` | Perek reader — מלכים א טו | Same pesukim in Taamey D: the traditional serifed taamim face, matching the website reader. |
| `after-tikkun.png` | תיקון קוראים flow | The canvas-drawn surface (`GraphicsView` + `ICanvas.DrawString`) in the same face — proof the platform-specific canvas resolution (Android asset filename) resolves the bundled typeface, not a fallback. |
| `glyph-compare.png` | composite | Same-word crops stacked: master fallback / after reader / after tikkun — the two after bands share glyph shapes that differ visibly from the before band. |

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
the shared contract; control tests pin the label default, span
inheritance and canvas font use on every reader surface listed above.
