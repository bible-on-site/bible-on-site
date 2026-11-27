---
version: alpha
name: 'Bible on Site · תנ"ך על הפרק'
description: Hebrew-first design for daily Tanah study, its encyclopedia and its editorial tools.
colors:
  primary: "#1552ac"
  light:
    canvas: "#ffffff"
    ink: "#171717"
    muted: "#666666"
    surface: "#f8fafc"
    pasuk-number: "#1c2c5d"
  dark:
    canvas: "#0f1219"
    ink: "#e8eaed"
    muted: "#9aa0a6"
    elevated: "#1a1f2e"
    surface: "#12151c"
    link: "#7eb0ff"
    pasuk-number: "#a8b9ff"
  high-contrast:
    light-link: "#0d3a8c"
    dark-link: "#4da3ff"
  native:
    surface-dark: "#2d2d2d"
    accent-on-dark: "#aacbff"
typography:
  web-article:
    fontFamily: "Al Heperek Font UI"
    fontSize: 1.1rem
    fontWeight: 400
    lineHeight: 1.8
  web-article-narrow:
    fontFamily: "Al Heperek Font UI"
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.8
  web-scripture:
    fontFamily: "Al Heperek Font UI"
    fontSize: 1em
    fontWeight: 400
    lineHeight: 2
rounded:
  sm: 4px
  md: 8px
  lg: 12px
  pill: 999px
spacing:
  accessibility-control-gap: 8px
  accessibility-panel-inline: 16px
  top-nav-gap: 1.25rem
motion:
  skeleton:
    duration: 1600ms
    timingFunction: ease-in-out
components:
  web-page-light:
    backgroundColor: "{colors.light.canvas}"
    textColor: "{colors.light.ink}"
  web-page-dark:
    backgroundColor: "{colors.dark.canvas}"
    textColor: "{colors.dark.ink}"
  web-reading-time-light:
    textColor: "{colors.light.muted}"
  web-reading-time-dark:
    textColor: "{colors.dark.muted}"
  web-solid-header:
    backgroundColor: "{colors.primary}"
    height: 72px
  web-accessibility-panel-light:
    backgroundColor: "{colors.light.canvas}"
    textColor: "{colors.light.pasuk-number}"
    rounded: "{rounded.lg}"
  web-accessibility-panel-dark:
    backgroundColor: "{colors.dark.elevated}"
    textColor: "{colors.dark.pasuk-number}"
    rounded: "{rounded.lg}"
  web-accessibility-reset-hover-light:
    backgroundColor: "{colors.light.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
  web-accessibility-reset-hover-dark:
    backgroundColor: "{colors.dark.surface}"
    textColor: "{colors.dark.link}"
    rounded: "{rounded.md}"
  web-prose-link-high-contrast-light:
    textColor: "{colors.high-contrast.light-link}"
  web-prose-link-high-contrast-dark:
    textColor: "{colors.high-contrast.dark-link}"
  native-author-card-count-dark:
    backgroundColor: "{colors.native.surface-dark}"
    textColor: "{colors.native.accent-on-dark}"
  web-article-body:
    typography: "{typography.web-article}"
---

## Overview

Bible on Site opens the daily perek, then lets the reader follow a pasuk into commentary, an article, an illustration or a Tanahpedia entry. Keep the Hebrew text, its source and the way back in view. The public website supports reading and sharing by URL. The native app also supports offline study. The admin serves editors who need to see exactly what they are publishing.

A sefer such as בראשית contains perakim. A pasuk is the numbered unit that readers select, cite or hear within a perek. The plurals are sefarim, perakim and pesukim. [Project terminology](docs/practices/implementation.md)

This guide maps decisions by subject. The linked implementation and merged revisions establish the baseline at [24 November 2026](https://github.com/bible-on-site/bible-on-site/tree/84301418f174571bfade8f11ed855ee727da5e4e). **Requested** and **preview** items below have separate issue records. When a decision changes, update its rule, tokens and source together. The YAML uses the [Google DESIGN.md format](https://github.com/google-labs-code/design.md/blob/db977b3c1d1f309269f43d5d17ae828d54bd6ae3/docs/spec.md).

## Colors

Use brand blue for the solid web header, ordinary light-theme links and native primary buttons. On the web, resolve foreground, surface, border, pasuk number and link colors through their semantic CSS variables so they follow the reader’s theme. In native dark mode use `AccentOnDark` for blue text and icons on dark surfaces. Keep white on the filled primary button. [Web palette](web/bible-on-site/src/app/globals.css) · [Native palette](app/BibleOnSite/Resources/Styles/Colors.xaml) · [Web token scale · #2899](https://github.com/bible-on-site/bible-on-site/pull/2899) · [Native contrast · #2719](https://github.com/bible-on-site/bible-on-site/pull/2719)

High contrast switches the full palette, including popovers and selected text. Preserve the system palette in forced-colors mode. Ordinary text pairs target at least 4.5:1 and large text 3:1. Give inline prose links a persistent underline and Tanahpedia mentions their dashed cue. High contrast and the site-wide underline option extend the cue across text links. [Accessibility requirements and measured pairs](docs/website/accessibility-requirements.md) · [Contrast and link preferences · #2774](https://github.com/bible-on-site/bible-on-site/pull/2774)

## Typography

Use Al Heperek Font UI for Hebrew interface text, articles and scripture, including niqqud and taamim. The addition of cantillation support superseded the earlier Taamey D default. Load the released 400, 600 and 700 weights and the approved `ss03` drawings. Preserve explicit Noto Serif Hebrew and Taamey D choices on the web, bundled Taamey D on native, and the bulletin PDF’s real italic face. Email needs a system fallback. [Release manifest](docs/branding/font-manifest.json) · [Earlier scripture default · #2011](https://github.com/bible-on-site/bible-on-site/pull/2011) · [Current face policy · #3694](https://github.com/bible-on-site/bible-on-site/pull/3694) · [Approved font release · #3692](https://github.com/bible-on-site/bible-on-site/pull/3692)

In the web perek reader, start at 100% size, line height 2 and word spacing 0.28em. Allow 85–200% type and five independent steps each for line and word spacing. Persist preferences across visits and apply them before paint. Preserve stored choices when extending the scale. Web article prose uses 1.1rem at line height 1.8, dropping to 1rem at widths up to 640px. [Reader settings](web/bible-on-site/src/lib/reader-settings.ts) · [Article typography](web/bible-on-site/src/app/929/[number]/[slug]/page.module.css) · [Spacing defaults · #2354](https://github.com/bible-on-site/bible-on-site/pull/2354)

## Layout

- **Web header.** Use one primary `main` landmark per page and a centered, home-linked wordmark in the 72px top bar. Keep the hamburger at the physical right. The homepage supplies its hero backdrop. Inner routes default to the solid bar. Global search normally sits at the left. On the על הפרק reader, reserve that space for reading controls and keep the accessibility trigger reachable above the book. [Header contract · #3179](https://github.com/bible-on-site/bible-on-site/pull/3179) · [Accessibility placement · #2659](https://github.com/bible-on-site/bible-on-site/pull/2659) · [Main landmarks · #3757](https://github.com/bible-on-site/bible-on-site/pull/3757)
- **Web drawer and home.** The shipped RTL drawer groups destinations under לימוד, תוכן and שירות. Give each destination its own icon, label, real link and visible current-page state. Keep store links nested. On the homepage, link each actionable hero card as a whole and link counters to their destinations. Give independent features their own visual band and shaped divider, as with the bulletin and the bookshelf. [Drawer and hero cards · #3703](https://github.com/bible-on-site/bible-on-site/pull/3703) · [Counters · #2565](https://github.com/bible-on-site/bible-on-site/pull/2565) · [Bulletin band · #3293](https://github.com/bible-on-site/bible-on-site/pull/3293)
- **Latest requested web drawer.** Use five groups in this order — לימוד על הפרק, חלוקות נוספות, אפשרויות לימוד נוספות, כלי לימוד, שונות. Keep one compact fixed header with the home-linked emblem and a labeled close control outside the menu's single scroll region. Lay every destination on the same RTL icon/text grid: icons center on the title line, subtitles begin at the same text inset, and title plus subtitle stay one generous target. Keep the three storefront links compact and visibly nested under יישומון, with LTR brand names and independent targets. The title and wrapping subtitle share one link and one keyboard stop. Preserve the bulletin’s WhatsApp join action outside the drawer; the separate WhatsApp drawer row stays retired. The issue specifies exact Hebrew copy and placement. [Requested copy and ordering · #3731](https://github.com/bible-on-site/bible-on-site/issues/3731) · [Initial grouping implementation · #3763](https://github.com/bible-on-site/bible-on-site/pull/3763) · [Mobile drawer refresh · #3839](https://github.com/bible-on-site/bible-on-site/issues/3839)
- **Native navigation.** The five groups above are already in the native flyout, with העדפות last under שונות. Keep hamburger and Back positions stable. Android uses system Back by default and offers an in-app opt-in. iOS provides Back and edge swipe. Windows uses the title-bar Back control. Escape dismisses the topmost surface first. On Windows, use the adaptive pane at 1008 DIP and center scripture in a column up to 920 DIP. [Native flyout · #3716](https://github.com/bible-on-site/bible-on-site/pull/3716) · [Back chrome · #3690](https://github.com/bible-on-site/bible-on-site/pull/3690) · [Desktop layout and shortcuts](docs/app/windows-desktop-ux.md)
- **Lists and cards.** Fold to a single reading column on narrow screens. Keep text and controls usable with 200% zoom. A web article carousel advances one card, restores its position on return and hides controls when everything fits. Omit empty article sections. Flatten rich abstracts to inline text for clamping so adjacent lines stay legible. [Article carousel · #1915](https://github.com/bible-on-site/bible-on-site/pull/1915) · [Return position · #2194](https://github.com/bible-on-site/bible-on-site/pull/2194) · [Abstract layout · #3691](https://github.com/bible-on-site/bible-on-site/pull/3691)

## Elevation & Depth

In Sefer, the book leaf itself is the reading surface. Lay article and commentary content directly on the leaf, put scrollbars beside the spine and leave the outer edge available for page turns. Fullscreen article content has one scroller. Keep the panel hierarchy flat even when the page is turning. [Sefer layout · #3056](https://github.com/bible-on-site/bible-on-site/pull/3056) · [Reader performance and visual invariants](docs/website/sefer-turn-performance.md)

Use the elevated surface, subtle border and 12px corners for the accessibility panel. It fits inside a 320px viewport and scrolls internally. A non-modal popover supports Escape, outside dismissal and focus return. A modal lightbox, journalism or admin dialog makes the background inert, contains Tab and Shift+Tab, and returns focus to its opener. [Accessibility panel](web/bible-on-site/src/app/components/top-nav-accessibility.module.css) · [Public dialogs · #3759](https://github.com/bible-on-site/bible-on-site/pull/3759) · [Admin dialogs · #3778](https://github.com/bible-on-site/bible-on-site/pull/3778)

## Shapes

Use the shared web radii for small markers (4px), controls (8px), panels (12px) and pill-shaped controls (999px). Draw interface icons on a 24-unit grid with a 2-unit stroke and rounded ends. Align drawer icons to the label. Give compact primary web controls a 44×44px hit area, expanding the invisible target around a smaller glyph where needed. Preserve recognizable brand and social glyphs. [Radius scale · #2899](https://github.com/bible-on-site/bible-on-site/pull/2899) · [Icon and target sizing · #2896](https://github.com/bible-on-site/bible-on-site/pull/2896) · [Centered gear · #3720](https://github.com/bible-on-site/bible-on-site/pull/3720)

Use the approved unframed emblem beside the outlined על הפרק wordmark. Choose the supplied light or reversed lockup for its surface. Use the fitted 16/24/32/48px masters for small icons, with the 32px composition at 24px. Native adaptive icons use a full-bleed background and a safe-zone foreground. [Logo masters](web/shared/branding/logos) · [Logo manifest](docs/branding/logo-manifest.json) · [Brand approval · #3554](https://github.com/bible-on-site/bible-on-site/pull/3554)

## Motion & Micro-interaction

- Gate hover effects on hover-capable devices. Keep keyboard focus, selected, disabled and pressed states independently recognizable. The web press scale is 0.97 on controls using the shared interaction treatment. [Interaction states · #2897](https://github.com/bible-on-site/bible-on-site/pull/2897)
- Shape loading placeholders like the arriving text or card, hide decorative pieces from assistive technology and supply a loading label. The normal shimmer travels in the reading direction. Use a static placeholder for reduced motion, forced colors or high contrast. Honor reduced motion for page scrolling too. [Skeletons · #2898](https://github.com/bible-on-site/bible-on-site/pull/2898) · [Reduced-motion scrolling · #3768](https://github.com/bible-on-site/bible-on-site/pull/3768)
- Preserve ordinary mouse text selection and vertical touch scrolling. In the flat perek reader, a deliberate horizontal touch swipe right advances and left goes back. A book turn must work by deliberate drag or the controls. Keep interactive content on the leaf selectable. [Text-reader gestures · #1959](https://github.com/bible-on-site/bible-on-site/pull/1959) · [Book selection · #2711](https://github.com/bible-on-site/bible-on-site/pull/2711)
- Follow the current spoken pasuk or word when it leaves the reading pane. Respect manual scrolling in the native app. When native recitation is enabled (the default), tapping a pasuk plays it when its sefer audio is downloaded and the pasuk has aligned timings. A long press enters selection, where subsequent taps select pesukim. [Recitation and selection · #2489](https://github.com/bible-on-site/bible-on-site/pull/2489) · [Follow playback · #3744](https://github.com/bible-on-site/bible-on-site/pull/3744)
- On native, opening a pasuk or previewing a word is local-only. Explicit Play or focused headphones can download a missing sefer audio pack, with progress, cancel and retry at the initiating control or pack row. [Native audio download on intent · #3723](https://github.com/bible-on-site/bible-on-site/pull/3723)

## Voice & Content Strategy

- **References.** Write plain Hebrew source references with spaces, as in `שמואל ב ה ו` and `בראשית ל ו-ח`. Use ASCII quotes, apostrophes and hyphens in authored UI. Preserve the biblical maqaf and marks in scripture and accept legacy punctuation on input. Divine-name masking is a display preference and keeps canonical text and pasuk identity intact. [Hebrew conventions](AGENTS.md) · [Masking policy](web/bible-on-site/src/lib/divine-name-masking.ts) · [Display and highlighting · #1908](https://github.com/bible-on-site/bible-on-site/pull/1908)
- **Quotations and notes.** Carry RTL blockquotes, attribution and emphasis into the web and native article renderers. Match the Hebrew footnote letter in running prose to the note list, include the way back and keep generated identifiers out of copied prose. [RTL quotations · #3503](https://github.com/bible-on-site/bible-on-site/pull/3503) · [Copyable text · #2661](https://github.com/bible-on-site/bible-on-site/pull/2661) · [Matching note markers · #2750](https://github.com/bible-on-site/bible-on-site/pull/2750)
- **Illustrations.** Give a perek scene a Hebrew alt description and a visible caption using the supplied pasuk or attributed commentary. Reuse the perek heading. Attach explicit inclusive pasuk ranges so a parasha or Masora selection can show the image by overlap. Require a WebP display image. Supply responsive AVIF sizes and a social JPEG when available. Treat the image as editorial interpretation. Use linked Tanahpedia entries for places and family relationships. [Illustration pilot](docs/website/bereshit-1-illustration.md) · [Responsive image formats · #1904](https://github.com/bible-on-site/bible-on-site/pull/1904) · [Pasuk ranges and captions · #2186](https://github.com/bible-on-site/bible-on-site/pull/2186)
- **Reading estimates.** Show the shared estimate for the content actually selected, including pasuk-scoped commentary. Omit an unknown count. A stored zero represents verified empty content. [Reading metrics](docs/data/reading-metrics.md) · [Selected commentary estimates · #3488](https://github.com/bible-on-site/bible-on-site/pull/3488)

## Components

### Perek, article and commentary readers

| When the reader… | Preserve this behavior | Decision |
| --- | --- | --- |
| Opens a perek link | Below 768px show flat, swipeable text. Where book view is available, an explicit `?book` is local to that visit. A single or ranged pasuk link without `?book` opens flat text at the passage even when book view is preferred. Keep saved mode independent by reading division. | [Reading modes · #3410](https://github.com/bible-on-site/bible-on-site/pull/3410) · [Visit vs. preference · #3748](https://github.com/bible-on-site/bible-on-site/pull/3748) · [Pasuk ranges · #3749](https://github.com/bible-on-site/bible-on-site/pull/3749) |
| Studies beside an open book | Pair scripture with commentary/articles. Group selected commentators by pasuk, keep the pasuk and notes mutually navigable, and date each perek panel by its own scheduled day. The toolbar and settings control the same bookmark visibility preference. Settings also control pinning. | [Pasuk navigation · #2173](https://github.com/bible-on-site/bible-on-site/pull/2173) · [Bookmark controls · #3056](https://github.com/bible-on-site/bible-on-site/pull/3056) · [Facing panel and pasuk selection · #2609](https://github.com/bible-on-site/bible-on-site/pull/2609) · [Perek dates · #3631](https://github.com/bible-on-site/bible-on-site/pull/3631) |
| Enters an article | In Sefer, lead with return to articles, put share and fullscreen at the other edge and restore the list position on return. A standalone article ends with חזרה לפרק and share. Share via the system sheet where available, respect cancellation and announce clipboard fallback. Author pages use name slugs and a searchable, sortable article table. | [Article actions · #2872](https://github.com/bible-on-site/bible-on-site/pull/2872) · [Author links · #2901](https://github.com/bible-on-site/bible-on-site/pull/2901) · [Author tables · #1982](https://github.com/bible-on-site/bible-on-site/pull/1982) |
| Adjusts reading | Put common font choices first, keep the masking switch visible and disclose spacing and per-name spellings on demand, and keep playback controls with playback settings. Reset only the options owned by the accessibility menu. Preserve masking, listening and study progress when resetting accessibility. | [Progressive disclosure · #2900](https://github.com/bible-on-site/bible-on-site/pull/2900) · [Reset scope · #2774](https://github.com/bible-on-site/bible-on-site/pull/2774) |
| Opens a native picker | Center the current perek in perek selection. Filter commentary rows in place by name. Distinguish a search with no matches from a missing commentary pack. Dismiss the topmost focused pasuk before the sheet beneath it. | [Picker behavior · #3340](https://github.com/bible-on-site/bible-on-site/pull/3340) · [Current perek · #3480](https://github.com/bible-on-site/bible-on-site/pull/3480) |

In the native reader, show progress for an individual article and omit it from the article catalogue. The articles tab offers divine-name masking in its options. In Tikkun, toggling vowels and cantillation keeps base letters, line breaks and scroll position stable so the reader can compare the same passage. [Article progress · #3367](https://github.com/bible-on-site/bible-on-site/pull/3367) · [Article settings · #3427](https://github.com/bible-on-site/bible-on-site/pull/3427) · [Tikkun text geometry · #3296](https://github.com/bible-on-site/bible-on-site/pull/3296)

### Alternate readings, calendar and bulletin

Keep each division’s vocabulary, navigation and pasuk boundaries. Reuse the shared reading breadcrumb for Moadim. In Parasha the route already identifies Torah, so the breadcrumb leads directly to the parasha. [Shared breadcrumb · #3300](https://github.com/bible-on-site/bible-on-site/pull/3300) · [Parasha hierarchy · #3171](https://github.com/bible-on-site/bible-on-site/pull/3171)

In Parasha, show all aliyah divisions inline and let the legend emphasize a minhag while the other boundaries stay visible. In Moadim, use the annual wheel and linked cards, Hebrew dates and one visible month label per context. Omit artificial sequence badges. [Masora terminology · #2213](https://github.com/bible-on-site/bible-on-site/pull/2213) · [Aliyah markers · #3178](https://github.com/bible-on-site/bible-on-site/pull/3178) · [Moadim labels · #3428](https://github.com/bible-on-site/bible-on-site/pull/3428) · [Card numbering · #3747](https://github.com/bible-on-site/bible-on-site/pull/3747)

Overview is the calendar default. Year and cycle views can open as a vertical spiral book from a saved preference or an explicit `?flip=1` link. Use Hebrew cycle numerals, show the perek source and combine Friday/Shabbat review cells where the schedule requires it. “Today” follows the Jerusalem study date, including nightfall. Keep historical cycles browsable and explain PDF availability for the selected period. [Calendar book · #3272](https://github.com/bible-on-site/bible-on-site/pull/3272) · [Perek sources · #3080](https://github.com/bible-on-site/bible-on-site/pull/3080) · [Review cells · #2704](https://github.com/bible-on-site/bible-on-site/pull/2704) · [Visibility and export](docs/website/calendar-pdf-artifacts.md)

Offer email, Telegram and WhatsApp as distinct bulletin join actions. Email and PDF share the wordmark, compact perek/date header and justified Hebrew reading content. Preserve article emphasis and right-align its final line. Browser reminders are opt-in. The **requested** web revision adds a reminder preference and dedicated section. Request browser permission only on an explicit enable click in that section. [Join choices · #3083](https://github.com/bible-on-site/bible-on-site/pull/3083) · [Email and PDF · #2876](https://github.com/bible-on-site/bible-on-site/pull/2876) · [Article emphasis · #2924](https://github.com/bible-on-site/bible-on-site/pull/2924) · [Reminder interaction · #3732](https://github.com/bible-on-site/bible-on-site/issues/3732)

### Search and Tanahpedia

- **Search.** Keep query and filters in the URL so a result set can be shared and Back restores it. Support a server-rendered GET search, keyboard traversal and labeled groups for perakim, pesukim, commentary, authors, articles and Tanahpedia. Match unpointed Hebrew to pointed text and link to the specific pasuk, note or phrase. [Search contract](docs/website/search.md) · [Exact-match destinations · #2112](https://github.com/bible-on-site/bible-on-site/pull/2112) · [Encyclopedia search · #2139](https://github.com/bible-on-site/bible-on-site/pull/2139) · [Typo-aware matching · #2199](https://github.com/bible-on-site/bible-on-site/pull/2199)
- **Previews.** Keep entity names as real links. Hover or keyboard focus reveals an anchored preview without moving prose. Escape dismisses it. Touch taps follow the link immediately. A pasuk citation preview fits above or below its anchor, stays inside the viewport, and closes on outside scroll or resize. Internal tooltip scrolling stays usable. [Entity previews · #3719](https://github.com/bible-on-site/bible-on-site/pull/3719) · [Citation previews · #3756](https://github.com/bible-on-site/bible-on-site/pull/3756)
- **Entries.** Show a Hebrew empty state for an empty category and distinguish unavailable data. Link pasuk occurrences back to scripture. In family trees, group children with their parents and keep spouse cards, continuous connectors, recorded order and attributed alternatives. Stack family groups vertically on a narrow screen. Use linked place pins with provider attribution. On native, follow entry links in place and have Back restore the previous entry and scroll position. [Categories · #1912](https://github.com/bible-on-site/bible-on-site/pull/1912) · [Occurrences · #1906](https://github.com/bible-on-site/bible-on-site/pull/1906) · [Family layout · #2137](https://github.com/bible-on-site/bible-on-site/pull/2137) · [Spouse cards · #3395](https://github.com/bible-on-site/bible-on-site/pull/3395) · [Place map · #1891](https://github.com/bible-on-site/bible-on-site/pull/1891) · [Native entry history · #3722](https://github.com/bible-on-site/bible-on-site/pull/3722)

### Editorial tools

Use the admin home for actionable counts and the Issues/PR queues. Each count opens the matching management view. Perek navigation accepts a canonical number or Hebrew name with keyboard selection. In a content PR, show the problem and evidence separately from a domain-field diff. Include changed fields for review and omit an unchanged primary perek. [Admin dashboard · #3718](https://github.com/bible-on-site/bible-on-site/pull/3718) · [Contribution workflow](docs/tanahpedia/contribution-workflow.md) · [Diff scope · #3766](https://github.com/bible-on-site/bible-on-site/pull/3766)

Typing in the Tanahpedia prose editor saves a recoverable local draft. Offer restore or discard. An explicit **שמור עכשיו** creates an attributed revision when content changed. Show conflicts if another editor moved the server revision. For reversible admin removals, defer the action for five seconds and offer ביטול. For an overwrite or a deletion that navigates away, use the labeled RTL confirmation dialog and restore focus on exit. [Editing model](docs/tanahpedia/admin-editing-model.md) · [Drafts and revisions · #2637](https://github.com/bible-on-site/bible-on-site/pull/2637) · [Undo and confirmation · #3717](https://github.com/bible-on-site/bible-on-site/pull/3717) · [Modal keyboard behavior · #3778](https://github.com/bible-on-site/bible-on-site/pull/3778)

### Accepted direction under review

| Surface | Apply this direction when working on the named feature | Record |
| --- | --- | --- |
| Native home and reader preview | Lead with the navy daily perek, use full-width Parasha and Moadim cards and alternate smaller white/blue pairs. Search stays at the top and includes destinations. Keep Tanah navigation, commentary and articles in a fixed dock. First drag starts the 1.8s idle-hide behavior. A new drag reveals the bars, active reading tools protect them and the commentary sheet overlays the dock. This is an opt-in preview. | [Owner decisions and exact copy · #3453](https://github.com/bible-on-site/bible-on-site/issues/3453) · [Preview branch · #3546](https://github.com/bible-on-site/bible-on-site/pull/3546) |
| Native action hierarchy | Filled blue for choose, download and retry. White outlined for cancel, reset and export. Explicit red for removal. Approved sizes are 48 DIP for normal actions, 52 for toolbar controls, 44 for compact controls. The shared-button direction includes ordinary builds when delivered. | [Approved button hierarchy · #3454](https://github.com/bible-on-site/bible-on-site/issues/3454) |
| Further reading | Beneath a perek’s regular articles, show לקריאה נוספת for visible articles whose primary perek is elsewhere and whose verified coverage includes a pasuk here. Deduplicate an article that matches multiple pesukim. The requested scope includes website and native. | [Requested behavior · #3752](https://github.com/bible-on-site/bible-on-site/issues/3752) · [Implementation under review · #3771](https://github.com/bible-on-site/bible-on-site/pull/3771) |
| Entry and author artwork | A requested Tanahpedia main image carries accessible attribution on web and native. The blue pencil sketch requested for the website’s Rabbis index is decorative and specific to that page. | [Entity images and credit · #3769](https://github.com/bible-on-site/bible-on-site/issues/3769) · [Rabbis index sketch · #3773](https://github.com/bible-on-site/bible-on-site/issues/3773) |

## Do's and Don'ts

Review a change through the reader’s and editor’s normal entry points.

- Follow a link to a pasuk range, open commentary or an article, then go Back. Check the original passage, scroll position and saved view preference.
- Read the same passage at 200%, with dark or high contrast, with reduced motion, by keyboard and on a narrow touch screen. Check that Hebrew marks, links, controls and the path back remain legible and operable.
- In an editor, try cancelling a deletion, recovering a draft and saving over a newer revision. Verify that the editor can tell what happened and which version is public.
