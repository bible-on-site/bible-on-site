# Al Heperek typography and logos

The shared brand face is Al Heperek Font UI 0.8.0, exported from the approved inscription design in the private `bible-on-site/al-heperek-font` repository. The export is reproducible with `tools/export_ui.py` at commit `e17a4fec33bc83da76a0ed74d8abe26155ab9ce8`. `font-manifest.json` records the source design and binary hashes.

The website, admin, native UI, article WebView and PDF prose use the same Hebrew drawings at weights 400, 600 and 700. The native article WebView embeds its font data for offline use. Scripture uses the existing Taamey D face. Cantillated article quotations in the bulletin renderer continue to use its separately licensed cantillation face so complete Hebrew clusters retain their mark positioning.

Al Heperek Font files carry the restricted `AlHeperek-license.txt`, including the permission to read and print authorized content. This exception to the repository's MIT license applies to the font software. Source outlines and font development remain in the private font repository. The public terms of use link to `/font-license.txt`.

## Brand artwork

The canonical outlined wordmark and launcher artwork are in `web/bible-on-site/source-assets/logos/`. The wordmark reads `על הפרק` beside the emblem. The reversed SVG is in `public/images/logos/header-logo-reversed.svg`. Each small icon has an individually fitted 16, 24, 32 or 48 pixel SVG and PNG. The favicon ICO packages those exact PNGs.

Run `node scripts/generate-brand-assets.mjs` from `web/bible-on-site/` to regenerate native launcher artwork, legacy web images, the touch icon and the shared PDF/header JPEG. Native icons use an opaque square background and receive the platform's launcher mask. Historical web-image URLs keep serving the current artwork.

Run `node web/bulletin/scripts/prepare-email-assets.mjs --sharp-module web/bible-on-site/node_modules/sharp` from the repository root to regenerate the email/PDF manifest. The email wordmark is served from the website at `/images/logos/header-logo.jpg`. Existing content-addressed S3 images remain available. These commands write repository files and require no asset upload.

Email clients that support web fonts load the three WOFF2 faces from the official website. Other email clients use the declared system fallback. The logo remains an image in either case.

The changes update repository assets for subsequent builds. App-store listing artwork is managed separately.

## Validation and rollback

The font export tests compare shaped glyphs and positions against the approved `ss02` design at every weight. UI checks include real browser captures, header alignment, font loading, and native unit tests. Bulletin PDF checks inspect embedded fonts, cantillation and missing glyphs.

The change preserves public routes and the existing Taamey D and reader-preference behavior. Calendar PDF render fingerprints include the new font filenames and logo bytes so generated documents refresh through the existing publication workflow. Reverting the adoption commit restores the prior typography and logo assets. Previously published content-addressed PDFs and images retain their URLs.
