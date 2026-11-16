# Al Heperek typography and logos

The shared brand face is Al Heperek Font UI 0.9.2, exported from the Yehuda reconstruction in the private `bible-on-site/al-heperek-font` repository. The export is reproducible with `tools/export_yehuda_ui.py`; `font-manifest.json` records the source design, export commit and binary hashes. The website, native application and logos use the same `ss03` drawings and companion figures by default, through the existing family names and asset paths.

The website, admin, native UI, article WebView and PDF prose use the same Hebrew drawings at weights 400, 600 and 700. The native article WebView embeds its font data for offline use. Scripture uses the existing Taamey D face. Cantillated article quotations in the bulletin renderer continue to use its separately licensed cantillation face so complete Hebrew clusters retain their mark positioning.

Al Heperek Font files carry the restricted `AlHeperek-license.txt`, including the permission to read and print authorized content. This exception to the repository's MIT license applies to the font software. Source outlines and font development remain in the private font repository. The public terms of use link to `/font-license.txt`.

## Brand artwork

The logo lettering uses the Yehuda reconstruction in Al Heperek Font 0.9.2 Bold, feature `ss03`. Every text run, including each instance of על, is outlined from that same face. `logo-manifest.json` records the font hash, source font commit and canonical SVG hashes. The glyph-free layouts and outline generator live in the private font repository at `sources/yehuda/logo-layouts/` and `tools/yehuda_logos.py`.

The canonical light/reversed wordmarks, launcher artwork and fitted SVG icons are in `web/bible-on-site/source-assets/logos/`. The wordmark reads `על הפרק` beside the unframed emblem. Each small icon has an individually fitted 16, 24, 32 or 48 pixel SVG and PNG. The 24px icon uses exactly the 32px composition. The favicon ICO packages those exact PNGs.

Run `node scripts/generate-brand-assets.mjs` from `web/bible-on-site/` to regenerate all 22 shared assets: public SVG copies, native launcher layers and splash, fitted favicon PNGs and both website/admin ICOs, legacy web images, the touch icon and shared PDF/header JPEG. Add `--check` to verify that every output matches its canonical source without writing. Native icons combine a full-bleed background with transparent artwork. Android scales the artwork into the adaptive icon's safe zone before applying the launcher's mask. The loading view uses the complete composite. Historical web-image URLs keep serving the current artwork.

Run `node web/bulletin/scripts/prepare-email-assets.mjs --sharp-module web/bible-on-site/node_modules/sharp` from the repository root to regenerate the email/PDF manifest. The email wordmark is served from the website at `/images/logos/header-logo.jpg`. Existing content-addressed S3 images remain available. These commands write repository files and require no asset upload.

Email clients that support web fonts load the three WOFF2 faces from the official website. Other email clients use the declared system fallback. The logo remains an image in either case.

The changes update repository assets for subsequent builds. App-store listing artwork is managed separately.

## Validation and rollback

The font export tests compare shaped glyphs and positions against the `ss03` design at every weight. UI checks include real browser captures, header alignment, font loading, and native unit tests. Bulletin PDF checks inspect embedded fonts, cantillation and missing glyphs.

The change preserves public routes and the existing Taamey D and reader-preference behavior. Calendar PDF render fingerprints include the new font filenames and logo bytes so generated documents refresh through the existing publication workflow. Reverting the adoption commit restores the prior typography and logo assets. Previously published content-addressed PDFs and images retain their URLs.
