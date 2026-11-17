# Al Heperek Font: Devin handoff

Dorad deferred the remaining font and logo work to **Devin Backlog** in `bible-on-site/bible-on-site`. This packet makes the work reproducible from this repository without access to a developer's machine, localhost, expiring CI artifacts or the private font repository.

## Exact starting point

- Source snapshot: `bible-on-site/al-heperek-font@d7c34847d6e103b6422ab9bd21355b44f352d525`.
- Selected letter forms: **א A22, ע E26, ט T21, צ C28, ש S35**.
- Final **ץ must use the companion belonging to C28**, not a previous standalone proposal.
- The combined face is a **separate Bold 700 review**, named **Al Heperek Selected Review**. Regular 400 and SemiBold 600 still contain the preceding design. The committed canonical UFOs have not yet adopted these six selected outlines.
- The selected review contains real OTF/WOFF2 text, all 27 Hebrew letters and ten digits, live typing, niqqud examples and nine matching outlined SVG logos.
- Original Yehuda SVG: `sources/yehuda/icon.svg` in the archive. His lettering was AI-created, not imported from an existing commercial font.
- Source recipe: `sources/yehuda/selected-refinements.json`. Exact paths and paired final: `sources/yehuda/refinements/*.json`.

This is the latest selected design, superseding the initial A01/E09/T07/C01/S03 directions and the old 0.9.2 application proof. A direction choice is not blanket approval of every weight, logo size or production/store publication.

## Files and integrity

`al-heperek-font-d7c3484.zip` contains **994 committed files**: all three editable UFO masters, original SVG, letter alternatives and exact selections, shared motif/spacing code, build/review tools and HTML templates, locked Python dependencies, tests, font exports, logo layouts/exports, current picker pages and selected review screenshots. It excludes Git history, credentials, virtual environments, local servers, caches and most historical screenshots. It is a scoped source snapshot, not a clone or history migration.

Archive SHA-256:

```text
ee6d57fa5c8983ad10014375ad2eaaa1c99f0d5bb63b9fa2d9835394556046ba
```

`manifest.json` records the archive size, origin, choices and OTF/WOFF2 hashes. The selected font's own manifest also records authored/compiled node counts, source hashes, coordinate precision and the unchanged master hash. The adjacent LICENSE.txt is copied verbatim from the original font license; that license is also inside the archive.

The packet was extracted to a fresh directory, the selected review was rebuilt using the locked project's installed dependencies, and **both font binaries reproduced their committed SHA-256 hashes**. No private font input outside the archive was used.

## Open the existing proof without rebuilding

From the root of a checkout containing this packet:

```sh
python -m zipfile -t docs/branding/al-heperek-handoff/al-heperek-font-d7c3484.zip
python -m zipfile -e docs/branding/al-heperek-handoff/al-heperek-font-d7c3484.zip /tmp/al-heperek-review
cd /tmp/al-heperek-review/al-heperek-font
python -m http.server 4177 --bind 127.0.0.1
```

Open `http://127.0.0.1:4177/specimens/selected.html`. Another available local port is fine. Do not depend on Dorad's localhost or Windows paths. The complete saved picker is `specimens/refinements.html`.

## Rebuild and validate

Use Python 3.14 and the committed uv lockfile:

```sh
uv sync --frozen
uv run python tools/build.py
uv run python tools/qa.py
uv run python tools/export_ui.py
uv run python tools/export_yehuda.py
uv run python tools/export_yehuda_ui.py
uv run pytest
uv run python tools/yehuda_refinements.py
uv run python tools/selected_review.py
```

`build.py` compiles the canonical UFOs without regenerating their design. `selected_review.py` builds the separate selected face from a temporary Bold UFO clone. It does **not** promote the choices to canonical masters. Its CFF export preserves authored contours by exact quadratic-to-cubic degree elevation; the compiled OTF and WOFF2 are compared to all six selected source contours.

Current source validation: **229 tests passed, 3/3 canonical styles passed QA**, six selected contours retained their authored node counts, and all nine review logos generated in [CI run 44046533656](https://github.com/bible-on-site/al-heperek-font/actions/runs/44046533656). Local browser checks exercised the real review font, typing, size slider, logo loading and overflow. The external private-repository pre-commit.ci paid-plan error is a service/billing limitation, not a font failure; do not change account settings to work around it.

## Remaining work for Devin

1. Finish the selected family coherently across **400 / 600 / 700**. Promote the selected geometry into maintained editable sources, preserving motif consistency and smooth low-node contours. Adapt the lighter weights deliberately; do not label the existing lighter design as updated. Keep matching צ/ץ heads/forks, balanced stroke weight including digits, correct א construction, and the original family's shared corner/terminal language.
2. Preserve the intentional extents of **ך ל ן ף ץ ק**. Verify Hebrew shaping, spaces/kerning, punctuation, niqqud, mixed RTL/LTR and numerals, small UI text, weight consistency and clipping. Preserve the authored source geometry; if a production outline format needs conversion, quantify that conversion and validate actual output rather than claiming unchanged binary nodes.
3. Build production TTF/WOFF2/UI exports with default glyph mapping, stable family aliases and provenance/hash manifests. The proof family name is not the production registration. Audit existing file names and every deployed copy before updating them.
4. Apply the approved family throughout the website, admin, native app, bulletin, calendar/PDF/download and email typography. **Taamey D remains the independently GPL-licensed scripture/cantillation font.** Do not import/trace Taamey D material or add cantillation U+0591-U+05AF to Al Heperek. Preserve reader settings and complete scripture font runs, including generated PDFs.
5. Regenerate all repository logos from the final same font. Every instance of **על** must use the same face. The wide lockup is **one על הפרק wordmark beside the book**, without a duplicate stacked name inside an emblem or nested frames. Keep the book and the other logo formats stylistically coherent. At 24px use the 32px composition; 16px may simplify. Audit web/admin favicons, 16/24/32/48, touch icons, native launcher/splash/foreground, compact/reversed/header, PDF and email copies, legacy paths, PNG/JPEG/ICO and alpha/opaque variants.
6. Preserve the **restricted Al Heperek license**, copyright/provenance and distributed notices. Verify the website/native TOS explicitly distinguish this font from other project content and separately licensed Taamey D; port or update the existing notice integration as needed. The main repository's general license does not relicense this packet.
7. Deliver a reviewable PR with before/after captures from the real website/admin/native/generated-document paths and a logo-resolution sheet. Dorad requested review of each logo resolution. Run the affected module checks and coverage/performance gates, audit complete CI/review feedback, and keep backwards-compatible public URLs and assets.

**Production adoption and store listing/distribution remain deferred.** Keep implementation in review until Dorad approves the combined family/logo results and intended rollout. In particular, check native release automation before merging an adoption PR; merging app changes may publish through the existing store pipeline. Do not treat this backlog intake as store-publication approval.

## Existing application integration reference

[PR #3438](https://github.com/bible-on-site/bible-on-site/pull/3438) is **closed and was not merged**, as verified on 2026-11-17. Its last public source commit was `804b3110774d7970d832f2110d9789859cce8dc8`; its 0.9.2 design predates these five selected forms. Treat it as an implementation reference, not an open delivery or evidence that current master contains that design.

Useful paths in that immutable public commit:

- `docs/branding/README.md`, `font-manifest.json`, `logo-manifest.json`.
- `web/bible-on-site/scripts/generate-brand-assets.mjs`.
- `web/bible-on-site/src/app/brand-font.ts`, public fonts, and `src/lib/download/fonts/`.
- `web/admin/public/fonts/`.
- `app/BibleOnSite/Helpers/BrandFonts.cs` and `Resources/Fonts/`.
- `web/bulletin/fonts/`.
- The earlier font license/TOS, generated calendar font-fit, email and launcher handling.

Inspect current master and port only the still-applicable changes. Do not merge the historical branch wholesale or copy unrelated worker/admin/performance changes merely because they share the old PR. Revalidate actual output; old screenshots/checks are historical evidence.

The private [source PR #5](https://github.com/bible-on-site/al-heperek-font/pull/5) remains the original design record; access to it is optional for using this packet. The source repository remains canonical for later upstream font maintenance. This handoff publishes no production assets and changes no application registrations.

