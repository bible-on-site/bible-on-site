# Website accessibility — requirement-to-implementation table

**Research date:** 23 October 2026 (issue #2396)

## Legal basis

- **Equal Rights for Persons with Disabilities (Service Accessibility
  Adjustments) Regulations, 5773-2013, regulation 35A** — requires new and
  existing public-service websites to conform to Israeli Standard 5568 at
  **level AA**.
- **ת״י 5568 חלק 1, September 2023 edition** (current; replaces the May 2021
  edition) — identical to **WCAG 2.0 (11 December 2008)** with Israeli
  national changes:
  - SC 1.2.4 Captions (Live) — raised to **AAA** (not required at AA).
  - SC 1.2.5 Audio Description (Prerecorded) — raised to **AAA**.
  - SC 2.4.10 Section Headings — required at **AA** (AAA in WCAG).
  - SC 3.1.2 Language of Parts — **not applicable**.
  - The part on digital documents was split into ת״י 5568 חלק 2.
- Sources: [SI 5568-1 PDF (Sept 2023)](https://www.gov.il/BlobFolder/legalinfo/israeli_accessibility_standards_pdf/he/sitedocs_si-5568-1-september-2023.pdf),
  [gov.il website-accessibility guide](https://www.gov.il/he/pages/website_accessibility),
  [gov.il statement guidance](https://www.gov.il/he/pages/declaration_website_accessibility).
- WCAG 2.1/2.2 criteria are **not** legally incorporated; where the site
  follows them anyway (e.g. `prefers-reduced-motion`) it is recorded as a
  voluntary improvement, not a legal claim.

## Requirement → implementation

| Source / criterion                                                    | Applies?                                                          | Required outcome                                                                 | Implementation / control                                                                                                                                                                                    | Gap / status                                                                                             |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| WCAG 2.0 SC 1.4.4 Resize text (AA)                                    | Yes — all text content                                            | Text resizable to 200% without assistive technology, no loss of content/function | Native browser zoom is unrestricted (no `maximum-scale`/`user-scalable` lock); reader text additionally exposes 85–200% scale via הגדרות קריאה and the top-nav נגישות menu                                  | Met — no in-site zoom widget is legally required                                                         |
| WCAG 2.0 SC 1.4.3 Contrast minimum (AA)                               | Yes                                                               | 4.5:1 body text, 3:1 large text                                                  | Authored color tokens must pass; the top-nav cluster uses white-on-brand-blue                                                                                                                               | Verified on the nav chrome (white on `#1552ac` ≈ 8.6:1); statement text `#1c2c5d`-family on white passes |
| WCAG 2.0 SC 2.1.1 Keyboard (AA)                                       | Yes                                                               | All functionality keyboard-operable                                              | Nav menu, נגישות menu, sliders, links all keyboard-reachable; Escape closes; focus restored to trigger                                                                                                      | Met — tested in unit/e2e + manual pass                                                                   |
| WCAG 2.0 SC 2.4.7 Focus visible (AA)                                  | Yes                                                               | Visible keyboard focus indicator                                                 | `:focus-visible` outlines on nav chrome, menu controls, reset and statement link                                                                                                                            | Met                                                                                                      |
| WCAG 2.0 SC 1.3.1 Info & relationships (AA)                           | Yes                                                               | Structure conveyed programmatically                                              | Semantic landmarks (`<nav>`, `<main>`, `<article>`, `<section>`), `aria-label`/`aria-expanded`/`aria-haspopup` on the disclosure trigger, `role="dialog"` non-modal popover, `role="status"` reset feedback | Met                                                                                                      |
| WCAG 2.0 SC 2.4.10 Section headings (AA in ת״י 5568 — Israeli change) | Yes                                                               | Headings organize the content                                                    | Statement page uses `h1` + per-section `h2`                                                                                                                                                                 | Met                                                                                                      |
| WCAG 2.0 SC 3.1.1 Language of page (AA)                               | Yes                                                               | Default language programmatic                                                    | `<html lang="he" dir="rtl">`; popovers carry `dir="rtl"`                                                                                                                                                    | Met                                                                                                      |
| WCAG 2.0 SC 3.1.2 Language of parts                                   | **No** — excluded by the Israeli national changes                 | —                                                                                | —                                                                                                                                                                                                           | n/a                                                                                                      |
| WCAG 2.0 SC 3.2.3 Consistent navigation (AA)                          | Yes                                                               | Nav presented consistently across pages                                          | Shared `TopNav`/`NavBar` in the root layout; this fix restores the bar's visibility on `/accessibility`                                                                                                     | Was broken (white-on-white); fixed via the established `layout.css` opt-in pattern                       |
| WCAG 2.0 SC 3.2.4 Consistent identification (AA)                      | Yes                                                               | Same functionality, same label                                                   | נגישות trigger keeps one accessible name `התאמות נגישות` on every route                                                                                                                                     | Met                                                                                                      |
| WCAG 2.0 SC 2.3.1 Three flashes (A)                                   | Yes                                                               | No flashing content                                                              | Counter/book animations are bounded, low-frequency                                                                                                                                                          | Met                                                                                                      |
| WCAG 2.0 SC 1.2.x time-based media                                    | Mostly exempt — 1.2.4/1.2.5 raised to **AAA** by national changes | Only AA-level criteria apply: 1.2.1–1.2.3 where media exists                     | Recitation audio is supplemental to full text (media alternative already present)                                                                                                                           | Legacy media captioning noted as a known limitation in the statement                                     |
| `prefers-reduced-motion` (WCAG 2.1/2.2 territory)                     | Voluntary improvement                                             | Honor OS motion preference                                                       | Site animations guard on the media query (counters, menu transitions); the reset never overrides OS settings                                                                                                | Met — beyond legal baseline                                                                              |
| In-site accessibility widget/overlay                                  | **Not legally required**                                          | —                                                                                | The נגישות menu is a product requirement; it reuses the real display preferences rather than a vendor overlay                                                                                               | Implemented per #2396                                                                                    |

## Design decisions this table drives

1. **No new preference model.** Font size, line/word spacing and verse font
   reuse `perekReaderSettings`; the menu and the הגדרות קריאה dialog stay
   synchronized through `READER_SETTINGS_EVENT` + `localStorage`.
2. **Reset scope.** `איפוס התאמות נגישות` restores only the four display
   adjustments to `DEFAULT_READER_SETTINGS` — divine-name masking, recitation
   settings, learning progress, analytics and bookmarks are preserved, and
   OS-level accessibility settings are never overridden.
3. **Statement accuracy.** The statement cites ת״י 5568 חלק 1 (Sept 2023) /
   WCAG 2.0 AA and keeps the honest known-limitations section; no
   full-compliance claim is made.
