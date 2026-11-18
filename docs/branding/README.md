# Al Heperek typography and logos

The shared brand face is Al Heperek Font UI 0.9.3, consumed as the compiled release archive `AlHeperekFont-v0.9.3.zip` from the `bible-on-site/al-heperek-font` repository (tag `v0.9.3`, archive SHA-256 `56e5e3ed26ad640b9f07bb51998450f024eeeb95effe7e672c216c4f05191cd2`). `font-manifest.json` records the release tag, source revision and per-file binary hashes; every copied font verifies against those hashes unchanged. The website, native application and logos use the same `ss03` drawings and companion figures by default, through the existing family names and asset paths. Font implementation stays upstream — compiled files are registered, embedded and copied as released, never patched or rebuilt here.

The website, admin, native UI, article WebView and PDF prose use the same Hebrew drawings at weights 400, 600 and 700. The native article WebView embeds its font data for offline use. Scripture uses the existing Taamey D face. Cantillated article quotations in the bulletin renderer continue to use its separately licensed cantillation face so complete Hebrew clusters retain their mark positioning.

Al Heperek Font files carry the restricted `AlHeperek-license.txt`, including the permission to read and print authorized content. This exception to the repository's MIT license applies to the font software. Source outlines and font development remain in the private font repository. The public terms of use link to `/font-license.txt`.

## Brand artwork

The logo lettering uses the Yehuda reconstruction in Al Heperek Font 0.9.3 Bold, feature `ss03`. Every text run, including each instance of על, is outlined from that same face. The release archive supplies the nine already-outlined SVG masters; `logo-manifest.json` records the font hash, source revision and canonical SVG hashes. The glyph-free layouts and outline generator live in the private font repository at `sources/yehuda/logo-layouts/` and `tools/yehuda_logos.py`.

The canonical light/reversed wordmarks, compact lockups, launcher artwork and fitted SVG icons are in `web/bible-on-site/source-assets/logos/`. The wordmark reads `על הפרק` beside the unframed emblem. Each small icon has an individually fitted 16, 24, 32 or 48 pixel SVG and PNG. The 24px icon uses exactly the 32px composition. The favicon ICO packages those exact PNGs.

Run `node scripts/generate-brand-assets.mjs` from `web/bible-on-site/` to regenerate all 22 shared assets: public SVG copies, native launcher layers and splash, fitted favicon PNGs and both website/admin ICOs, legacy web images, the touch icon and shared PDF/header JPEG. Add `--check` to verify that every output matches its canonical source without writing. Native icons combine a full-bleed background with transparent artwork. Android scales the artwork into the adaptive icon's safe zone before applying the launcher's mask. The loading view uses the complete composite. Historical web-image URLs keep serving the current artwork.

Run `node web/bulletin/scripts/prepare-email-assets.mjs --sharp-module web/bible-on-site/node_modules/sharp` from the repository root to regenerate the email/PDF manifest. The email wordmark is served from the website at `/images/logos/header-logo.jpg`. Existing content-addressed S3 images remain available. These commands write repository files and require no asset upload.

Email clients that support web fonts load the three WOFF2 faces from the official website. Other email clients use the declared system fallback. The logo remains an image in either case.

The changes update repository assets for subsequent builds. App-store listing artwork is managed separately.

## Validation and rollback

Every copied font, logo master and the restricted license verifies against the release manifest SHA-256 values, and both generator `--check` modes confirm derived assets match their canonical sources. UI checks include real browser captures, header alignment, font loading, and native unit tests. Bulletin PDF checks inspect embedded fonts, cantillation and missing glyphs.

The change preserves public routes and the existing Taamey D and reader-preference behavior. Calendar PDF render fingerprints include the new font filenames and logo bytes so generated documents refresh through the existing publication workflow. Reverting the adoption commit restores the prior typography and logo assets. Previously published content-addressed PDFs and images retain their URLs.
