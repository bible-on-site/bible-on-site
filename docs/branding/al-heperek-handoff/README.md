# BibleOnSite integration of Al Heperek Font 0.9.3

This handoff is **application integration only**. All font implementation and future font releases remain with the maintainer of `bible-on-site/al-heperek-font`.

Use the supplied **compiled** release: Regular 400, SemiBold 600 and Bold 700, each in TTF and WOFF2. All 27 Hebrew letters and ten digits use the selected design by default. A22 / E26 / T21 / C28 / S35 and C28's paired ץ are already implemented upstream.

## Inputs

- `AlHeperekFont-v0.9.3.zip`: six ready fonts, nine already-outlined SVG logos, license, integration instructions and file hashes.
- `AlHeperekFont-v0.9.3.sha256`: archive checksum.
- `release-manifest.json`: exact manifest from inside that ZIP.
- `manifest.json`: handoff provenance and archive identity.
- `LICENSE.txt`: unchanged restricted font license.
- `release-proof.png`, `release-browser.jpg`: real compiled-font and browser evidence.

The ZIP contains **no** UFOs, glyph/source artwork, compiler code or development tools. The earlier source-snapshot handoff is withdrawn and replaced by this compiled-only packet. Do not follow its historical font-development checklist.

Canonical font release: https://github.com/bible-on-site/al-heperek-font/releases/tag/v0.9.3 . The compiled mirror here is byte-identical and does not require private-repository access, expiring CI artifacts or Dorad's localhost.

## Scope boundary

Allowed:
- Copy/register/embed the exact released TTF/WOFF2 files in website, admin, native app, bulletin, PDF/calendar/download and email paths; update application asset/version pins and registration aliases.
- Use the supplied SVG paths as authoritative logo masters. Render/resize them for required PNG/JPEG/ICO/native packaging and backgrounds while preserving the supplied design, transparency and wide-logo composition.
- Update application license/TOS notices, serve the font-license URL used by the metadata, validate all copied hashes and test real rendering/compatibility.

Not delegated:
- Glyph outlines, UFO/SVG font sources, shared motifs, weights, spacing, kerning, anchors, OpenType features, font metadata/naming, compiler/export code, font conversion/subsetting or font releases.
- Do not rebuild, patch, relabel or regenerate the font. Do not reconstruct logo lettering with an application/system font.
- If a glyph/font defect is found, report it to the font maintainer and request a new version. Keep any dependent integration change pending; do not fix the font in the application repository.

## Application requirements

1. Register actual **400/600/700** files and keep compatible existing application aliases/filenames/public asset URLs. Do not synthesize the missing weight or convert font formats; both required formats are supplied.
2. Preserve Taamey D and its independent license for scripture/cantillation, including whole cantillated PDF runs. Al Heperek deliberately excludes U+0591-U+05AF.
3. Integrate every repository logo copy from the supplied outlined masters. The wide logo is one `על הפרק` wordmark beside the book only. Every על is already drawn with E26. No duplicate stacked emblem/name or nested frames. At 24px preserve the 32px composition; use the supplied 16px simplification.
4. Audit web/admin favicons, touch icons, native launcher/splash/foreground, compact/header/reversed, PDF/email and legacy copies. Preserve opaque/transparent variants and existing public/crawled URLs. Include the licensed font in all required native/document builds.
5. Preserve the restricted license and copyright. Update website/native TOS and distributed notices without relicensing other project works.
6. Validate actual website/admin/native/document output, font loading, small/narrow/large text, mixed Hebrew/Latin/numerals, niqqud, clipping, links/selection, performance, coverage and public URL compatibility. Provide before/after and per-logo-resolution evidence in the PR.
7. Keep app/store production rollout and listing/distribution deferred until Dorad intends it. Native adoption may trigger an existing automatic store pipeline; inspect that before merging an adoption PR.

## Fetch the packet from a normal repository checkout

On Linux/Devin:

```sh
git fetch origin codex/al-heperek-devin-backlog
git show FETCH_HEAD:docs/branding/al-heperek-handoff/AlHeperekFont-v0.9.3.zip > /tmp/AlHeperekFont-v0.9.3.zip
python -m zipfile -t /tmp/AlHeperekFont-v0.9.3.zip
python -m zipfile -e /tmp/AlHeperekFont-v0.9.3.zip /tmp/al-heperek-release
```

Verify the ZIP checksum and every copied file against the supplied manifests. No font build environment or private source checkout is needed.

## Historical application reference

PR #3438 is **closed and not merged**. Its public source commit `804b3110774d7970d832f2110d9789859cce8dc8` contains earlier registrations, TOS/notices and `web/bible-on-site/scripts/generate-brand-assets.mjs`. Use still-applicable application integration only after inspecting current master. Do not merge that historical branch wholesale or import unrelated worker/admin/performance changes. Its older 0.9.2 fonts and screenshots do not validate this release.

