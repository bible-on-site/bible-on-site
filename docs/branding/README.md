# Al Heperek typography and logos

The shared brand face is Al Heperek Font UI, consumed as a compiled release archive from the private `bible-on-site/al-heperek-font` repository. [The font manifest](font-manifest.json) records the installed release tag, source revision, archive hash and per-file hashes. The website, native application and logos use the same `ss03` drawings and companion figures by default, through the existing family names and asset paths. Font implementation stays upstream. Consumers register, embed or copy compiled files as released.

The website, admin, native UI, article WebView and PDF prose use the same Hebrew drawings at weights 400, 600 and 700. The native article WebView embeds its font data for offline use. Al Heperek is the default scripture face on the website and in the native app, including for niqqud and cantillation. The website offers Noto Serif Hebrew and Taamey D in the reader settings and uses them as glyph fallbacks. The native app bundles Taamey D as a separately licensed alternative. Bulletin PDFs use Al Heperek for scripture and prose and use Taamey Frank CLM for italic and bold-italic text.

Al Heperek Font files carry the [restricted font license](../../web/shared/branding/fonts/AlHeperek-license.txt), including the permission to read and print authorized content. This exception to the repository's MIT license applies to the font software. Source outlines and font development remain in the private font repository. The public terms of use link to `/font-license.txt`. Taamey D includes a separate license in the [website](../../web/bible-on-site/src/app/fonts/TaameyD-license.txt) and [native app](../../app/BibleOnSite/Resources/Fonts/TaameyD-license.txt).

## Brand artwork

The logo lettering uses the Yehuda reconstruction in Al Heperek Font Bold, feature `ss03`. Every text run, including each instance of על, is outlined from that same face. The release archive supplies the nine already-outlined SVG masters. [The logo manifest](logo-manifest.json) records the font hash, source revision and canonical SVG hashes. The glyph-free layouts and outline generator live in the private font repository at `sources/yehuda/logo-layouts/` and `tools/yehuda_logos.py`.

The canonical light/reversed wordmarks, compact lockups, launcher artwork and fitted SVG icons are in `web/shared/branding/logos/`, the compiled fonts and license in `web/shared/branding/fonts/`, and the derived rasters/composites in `web/shared/branding/derived/` — one tracked copy for every consumer (#3708). The wordmark reads `על הפרק` beside the unframed emblem. Each small icon has an individually fitted 16, 24, 32 or 48 pixel SVG and PNG. The 24px icon uses exactly the 32px composition. The favicon ICO packages those exact PNGs.

Each consumer stages or references the shared directory at build time; no per-consumer duplicates are tracked:

- **Website** — `next.config.mjs` and `scripts/stage-brand-assets.mjs` copy the WOFF2s, license, logo SVG/JPEG/webp set, favicon resolutions and touch icon into `public/` (keeping every historical URL) plus the TTFs and header JPEG the PDF renderers read under `src/lib/download/`. The app-router `src/app/favicon.ico` is the shared ICO.
- **Admin** — `vite.config.ts` stages the WOFF2s, license and `favicon.ico` into `public/`.
- **Native app** — `BibleOnSite.csproj` includes the shared TTFs, icon/splash layers and header JPEG directly with the same resource names.
- **Bulletin** — `build.rs` stages the TTFs into `web/bulletin/fonts/` and the PDF embeds the shared header JPEG; the Lambda zip packs the shared TTFs.

Run `node scripts/generate-brand-assets.mjs` from `web/bible-on-site/` to regenerate the derived set under `web/shared/branding/derived/`: native launcher layers and splash, fitted favicon PNGs and the ICO, legacy web images, the touch icon and the shared PDF/header JPEG. Add `--check` to verify that every output matches its canonical source without writing. Native icons combine a full-bleed background with transparent artwork. Android scales the artwork into the adaptive icon's safe zone before applying the launcher's mask. The loading view uses the complete composite. Historical web-image URLs keep serving the current artwork.

Run `node web/bulletin/scripts/prepare-email-assets.mjs --sharp-module web/bible-on-site/node_modules/sharp` from the repository root to regenerate the email manifest; the PDF header embeds the shared derived JPEG directly. The email wordmark is served from the website at `/images/logos/header-logo.jpg`. Existing content-addressed S3 images remain available. These commands write repository files and require no asset upload.

Email clients that support web fonts load the three WOFF2 faces from the official website. Other email clients use the declared system fallback. The logo remains an image in either case.

The changes update repository assets for subsequent builds. App-store listing artwork is managed separately.

## Release upgrades

[Upgrade Al Heperek Font](../../.github/workflows/upgrade-al-heperek-font.yml) runs daily and supports a manual run on the default branch. If a PR from `automation/al-heperek-font` to the default branch is open, the workflow waits for it to merge or close before preparing another upgrade. This preserves the PR's commits and review evidence. The workflow reads the private release with a GitHub App installation token scoped to Contents read on the font repository. The consumer repository holds the app client ID in `FONT_RELEASE_READER_CLIENT_ID` and its key in the `FONT_RELEASE_READER_PRIVATE_KEY` Actions secret. The workflow uses `BOT_PAT` to open the upgrade PR on the automation branch. The workflow imports only a newer stable release into `web/shared/branding/`, verifies the GitHub archive digest and each copied asset against the release manifest, and regenerates the shared derived assets every consumer stages from. The PR stays open for typography, logo and license review before merge.

## Validation and rollback

Every copied font, logo master and the restricted license verifies against the release manifest SHA-256 values, and both generator `--check` modes confirm derived assets match their canonical sources. UI checks include real browser captures, header alignment, font loading, and native unit tests. Bulletin PDF checks inspect embedded fonts, cantillation and missing glyphs.

Calendar PDF render fingerprints include the font files and logo bytes so generated documents refresh through the publication workflow. Reverting a font upgrade restores the previous typography and logo assets. Previously published content-addressed PDFs and images retain their URLs.
