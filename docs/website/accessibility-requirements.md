# Website accessibility — requirement-to-implementation table

**Research date:** 23 October 2026 (issue #2396); updated 28 October 2026
(issue #2767 — contrast/links preferences, link non-color cues, level and
measurement corrections).

## Legal basis

- **Equal Rights for Persons with Disabilities (Service Accessibility
  Adjustments) Regulations, 5773-2013, regulation 35A** — requires new and
  existing public-service websites to conform to Israeli Standard 5568 at
  **level AA**. Conforming at level AA means satisfying every level **A**
  *and* level **AA** criterion (AA includes A); level labels in the table
  below cite each criterion's own WCAG 2.0 level.
- **ת״י 5568 חלק 1, September 2023 edition** (current; replaces the May 2021
  edition) — identical to **WCAG 2.0 (11 December 2008)** with Israeli
  national changes:
  - SC 1.2.4 Captions (Live) — raised to **AAA** (not required at AA).
  - SC 1.2.5 Audio Description (Prerecorded) — raised to **AAA**.
  - SC 2.4.10 Section Headings — required at **AA** (AAA in WCAG).
  - SC 3.1.2 Language of Parts — **not applicable**.
  - The part on digital documents was split into ת״י 5568 חלק 2.
- Sources:
  [Service Accessibility Adjustments Regulations (gov.il PDF)](https://www.gov.il/BlobFolder/guide/accommodating_service_providing_rules/he/sitedocs_service_acessibility_regulations.pdf),
  [gov.il website-accessibility guide](https://www.gov.il/he/pages/website_accessibility),
  [SI 5568-1 catalogue page (SII)](https://www.sii.org.il/lobby/standardization/standard-page/?id=6751),
  [SI 5568-1 PDF (Sept 2023)](https://www.gov.il/BlobFolder/legalinfo/israeli_accessibility_standards_pdf/he/sitedocs_si-5568-1-september-2023.pdf).
- WCAG 2.1/2.2 criteria are **not** legally incorporated; where the site
  follows them anyway (e.g. `prefers-reduced-motion`, enhanced-contrast
  palette) it is recorded as a voluntary improvement, not a legal claim.

## Requirement → implementation

"Verified" rows state the tested scope explicitly; a row is not a sitewide
conformance claim. Contrast ratios were computed with the WCAG relative-
luminance formula on the exact hex pairs below.

| Source / criterion | Required outcome | Observed gap | Implementation / control | Test evidence & scope |
| --- | --- | --- | --- | --- |
| ת״י 5568-1 / WCAG 2.0 SC 1.4.1 Use of Color (**A**) | Color is not the only means of conveying link identity | Inline links inside DB-authored prose (`.articleBody`, `.noteContent`, `.entryContent`, `.homepageContent`) were `#1552ac`-blue only — ~1.4:1 off the surrounding text with the `a { text-decoration: none }` reset hiding them; footnote sup markers and the `↩` backref relied on color too | Persistent `text-decoration: underline` + `--link-accent` on all prose links; sup markers keep the shared `--footnote-marker-color` token and the backref keeps its `↩` glyph (both are affordances, not color-only); Tanahpedia mention anchors keep their dashed bottom border; opt-in `קו תחתון לקישורים` underlines every `a[href]` site-wide via `html[data-a11y-links]` (icon-only anchors excluded) | Unit: component/store coverage; e2e: underline presence computed-style checks on a prose link, dynamic mention and footnote ref on `/929` + article + pedia entry |
| ת״י 5568-1 / WCAG 2.0 SC 1.4.3 Contrast (Minimum) (**AA**) | ≥4.5:1 body text, ≥3:1 large text | Earlier revision of this table quoted **8.6:1** for white-on-`#1552ac` — the measured value is **≈7.4087:1** (WCAG luminance formula). Two accent colors failed AA outright: `#9a92d1` breadcrumb/sefer-heading purple measured **2.84:1**, and `#6366f1` pedia accent measured **~4.35:1** at 0.9rem | Authored colors now resolve through tokens (`--muted-text`, `--link-accent`, `--pasuk-num-color`, `--border-subtle`, `--surface-*`, `--hc-accent`) so the high-contrast palette reskins them; the two failing accents were deepened to `#6f63b8` (**5.07:1**) and `#4f46e5` (**6.28:1**). Measured normal-mode pairs: white on `#1552ac` **7.41:1**, `#171717` on `#fff` **17.95:1**, `#666` on `#fff` **5.77:1**, `#e8eaed` on `#0f1219` **15.54:1**, `#7eb0ff` on `#0f1219` **8.51:1**, `#9aa0a6` on `#0f1219` **7.07:1** | Computed ratios documented here; e2e contrast assertions on the nav chrome and statement page (light + dark) |
| Voluntary enhancement / WCAG 2.0 SC 1.4.6 Contrast (Enhanced) (**AAA** — not required for AA conformance) | Provide a coordinated higher-contrast option | No in-site control existed | `ניגודיות גבוהה` toggle in the נגישות menu sets `html[data-a11y-contrast="high"]`; dedicated light and dark palettes target the ≥7:1 band — measured pairs: `#000`/`#fff` 21:1, `#4d4d4d`/`#fff` **8.45:1**, `#0d3a8c`/`#fff` **10.49:1**, `#3d2f8f`/`#fff` **10.5:1**, `#8b0000`/`#fff` **10.0:1**, dark: `#b3b3b3`/`#000` **9.99:1**, `#4da3ff`/`#000` **7.99:1**, `#b7adf0`/`#000` **10.2:1**, `#ff8080`/`#000` **8.64:1**. HC link accents stay <3:1 against body text, so the palette implies the underline cue (SC 1.4.1). `::selection`, forced-colors and the a11y menu itself follow the palette | Computed ratios; e2e asserts the applied attribute + computed colors on real surfaces in light/dark + forced-colors emulation |
| ת״י 5568-1 / WCAG 2.0 SC 1.4.4 Resize text (**AA**) | Text resizable to 200% without loss of content/function | None | Native browser zoom is unrestricted (no `maximum-scale`/`user-scalable` lock); reader text additionally exposes 85–200% scale via הגדרות קריאה and the נגישות menu; menu is bounded (`max-height`, `overflow-y: auto`) and `min(320px, 100vw-24px)` wide for small RTL viewports | e2e: 200% zoom pass on homepage + `/929` + statement; 320px RTL viewport menu-scroll check |
| ת״י 5568-1 / WCAG 2.0 SC 2.1.1 Keyboard (**A**) | All functionality keyboard-operable | None | Nav menu, נגישות menu, sliders, checkboxes, links all keyboard-reachable; Escape closes; focus restored to trigger | Unit tests + manual keyboard pass on nav chrome and menu |
| ת״י 5568-1 / WCAG 2.0 SC 2.1.2 No Keyboard Trap (**A**) | Focus never trapped | None | Non-modal popover (no focus trap); Escape always closes; pointer-down outside dismisses | Unit tests (Escape/outside-dismiss) + e2e |
| ת״י 5568-1 / WCAG 2.0 SC 2.3.1 Three Flashes (**A**) | No flashing content | None | Counter/book animations are bounded, low-frequency | Manual review |
| ת״י 5568-1 / WCAG 2.0 SC 2.4.7 Focus Visible (**AA**) | Visible keyboard focus indicator | None | `:focus-visible` outlines on nav chrome, menu controls (incl. the new checkboxes), reset and statement link; outlines follow `--link-accent` so they stay visible under high contrast | Unit/e2e focus checks + screenshots |
| ת״י 5568-1 / WCAG 2.0 SC 1.3.1 Info & Relationships (**A**) | Structure conveyed programmatically | None | Semantic landmarks (`<nav>`, `<main>`, `<article>`, `<section>`), `aria-label`/`aria-expanded`/`aria-haspopup`/`aria-controls` on the disclosure trigger, `role="dialog"` non-modal popover, `role="status"` reset feedback | Unit tests assert roles/attributes |
| ת״י 5568-1 / WCAG 2.0 SC 4.1.2 Name, Role, Value (**A**) | Controls expose name/role/state | None | New toggles are real `<input type="checkbox">` inside a `<label>` — native checked state is exposed without ARIA; sliders/select expose `aria-label`; reset announces once via `role="status"` (no repeated live chatter while reading) | Unit tests assert checked state + accessible names |
| ת״י 5568-1 / WCAG 2.0 SC 2.4.10 Section Headings (**AA** in ת״י 5568 — Israeli change) | Headings organize the content | None | Statement page uses `h1` + per-section `h2` | Statement page unit test |
| ת״י 5568-1 / WCAG 2.0 SC 3.1.1 Language of Page (**A**) | Default language programmatic | None | `<html lang="he" dir="rtl">`; popovers carry `dir="rtl"` | Layout/e2e assertion |
| ת״י 5568-1 / WCAG 2.0 SC 3.1.2 Language of Parts | — | — | **Not applicable** under the Israeli national changes | n/a |
| ת״י 5568-1 / WCAG 2.0 SC 3.2.3 Consistent Navigation (**AA**) | Nav presented consistently across pages | Was broken (white-on-white) on `/accessibility`; fixed in #2396 via the `layout.css` opt-in pattern | Shared `TopNav`/`NavBar` in the root layout; the נגישות trigger keeps one accessible name and the same docked slot on every route | e2e navigation pass |
| ת״י 5568-1 / WCAG 2.0 SC 3.2.4 Consistent Identification (**AA**) | Same functionality, same label | None | נגישות trigger keeps one accessible name `התאמות נגישות` on every route | e2e + unit |
| ת״י 5568-1 / WCAG 2.0 SC 1.2.1–1.2.3 time-based media (A/AA) | AA-level criteria apply where time-based media exists | Not a blanket exemption: 1.2.4/1.2.5 were raised to AAA by the national changes, but 1.2.1–1.2.3 still apply to prerecorded audio/video content | Recitation audio is supplemental to the full rendered text (a media alternative is already present for the same content); legacy media without captions is disclosed rather than exempted | Known limitation disclosed in the statement; per-asset audit outstanding |
| `prefers-reduced-motion` (WCAG 2.1/2.2 territory) | Honor OS motion preference | — | Site animations guard on the media query (counters, menu transitions); the site preferences never override OS settings | Voluntary — beyond legal baseline |
| `forced-colors: active` (platform feature; relates to 1.4.x) | Site stays usable when the OS imposes its palette | Global `a { color: inherit }` erased link identity under forced colors | `@media (forced-colors: active)` restores `LinkText` + persistent underline; neither site preference overrides the OS palette | e2e forced-colors emulation pass |
| In-site accessibility widget/overlay | — | — | Not legally required; the נגישות menu is a product requirement that drives the site's real preferences rather than a vendor overlay | Implemented per #2396 + #2767 |

## Preference ownership & persistence (implementation contract, #2767)

- **Two stores, two owners.** Font size, line/word spacing and verse font
  stay in `perekReaderSettings` (`src/lib/reader-settings.ts`); ניגודיות
  גבוהה and קו תחתון לקישורים live in `siteA11ySettings`
  (`src/lib/site-a11y-settings.ts`). The reader normalizer rebuilds a fixed
  schema, so global preferences must not hitchhike on it — the separate key
  keeps the הגדרות קריאה dialog from dropping them.
- **Pre-paint bootstrap.** Both stores run an inline literal in the root
  layout `<head>` (`READER_SETTINGS_BOOTSTRAP`, `SITE_A11Y_BOOTSTRAP`) so
  stored values apply to `<html>` before first paint on direct load, reload
  and client navigation — no palette/underline flash.
- **Validated storage.** `localStorage` payloads are JSON-parsed inside
  `try/catch` and normalized field-by-field (`=== true`); corrupt payloads,
  quota errors and private mode degrade to defaults without throwing.
- **Sync.** `SITE_A11Y_EVENT` mirrors `READER_SETTINGS_EVENT` for same-tab
  writers, and the `storage` event keeps every open tab consistent.
- **Reset scope.** `איפוס התאמות נגישות` restores all six menu-owned
  adjustments (four reader settings + both site toggles) immediately and
  idempotently — divine-name masking, recitation, learning state/bookmarks,
  analytics choices and all other `localStorage` keys are preserved, and
  OS-level accessibility preferences are never overridden.

## Design decisions this table drives

1. **Underline is baseline in prose, opt-in globally.** Links that lived in
   running text get a persistent underline unconditionally (SC 1.4.1);
   navigation, card, badge and button-style links keep their existing
   affordances unless the user opts into `קו תחתון לקישורים`, which then
   applies to every `a[href]` (icon-only anchors excluded).
2. **High contrast is a palette, not a filter.** Token-driven so portals and
   dynamically rendered content follow; it keeps brand identity while
   pushing measured pairs into the 1.4.6 band, and it implies the underline
   cue because the HC link accent is <3:1 against body text.
3. **Statement accuracy.** The statement cites ת״י 5568 חלק 1 (Sept 2023) /
   WCAG 2.0 AA and keeps the honest known-limitations section; no
   full-compliance claim is made, and "verified" rows name their scope.
