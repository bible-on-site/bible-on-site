# Evidence — #3261 Native מועדים על הפרק reader

Captures from the Windows unpackaged debug build
(`net10.0-windows10.0.19041.0/win-x64/BibleOnSite.exe`), driven through UI
Automation (`UIAutomationClient` from PowerShell) against the live app data
directory. The flyout nav pane is pinned open on wide windows, so the
catalogue/reader captures also show the pinned pane with the
מועדים על הפרק destination in its selected state.

## What each file shows

| File | Content |
| --- | --- |
| `after-flyout-entry.png` | The shared flyout open on the catalogue page. The new **מועדים על הפרק / קריאות לימוד למועדים** destination sits between פרשה על הפרק and רכנים and renders highlighted as the current page. |
| `after-moadim-list.png` | `MoadimListPage` (`AutomationId=MoadimMenuButton`): published moadim grouped by Hebrew month — תשרי (ראש השנה, יום כיפור), ללא חודש (שבת שובה), אב (תשעה באב) — each row showing the moed name and date label. |
| `after-moed-reader.png` | `MoedPage` for ראש השנה: moed heading + date label (א-ב בתשרי) + summary (יום הזיכרון והתקיעה), a labelled section header **קריאת תורה — יום ראשון** with its source refs (בראשית כא א-י), the canonical perek header בראשית כא, and the resolved pesukim — all rendered through the shared reader chrome (bottom nav bar, fullscreen/source controls). |

## Data source

The production `moadim` GraphQL resolver currently answers
`INTERNAL_SERVER_ERROR` (`{"data":null,"errors":[{...,"path":["moadim"]}]}` on
`https://api.xn--febl3a.com`), so the running instance was seeded with a
representative `moadim_cache.json` in
`%LOCALAPPDATA%/DoradSoft/54181DoradSoft.929-/Data/` — exactly the file the
service writes after a successful fetch, exercising the same
API → cache → render pipeline end to end. Scripture text, section ordering,
labels, and range clipping resolve through the local canonical corpus just as
with live data; only the catalogue payload was pre-seeded.

## Limitations

- The catalogue content above comes from the seeded cache fixture (four
  published moadim covering month grouping, a month-less entry, ordered
  sections, and clipped ranges), not the production catalogue — the production
  resolver error is a server-side issue tracked separately from this PR.
- iOS/macOS verification is unavailable from this Windows host (no
  Xcode/MacCatalyst toolchain). Android emulator verification was blocked by
  insufficient disk space for the AVD on this machine.
- Reader behaviors exercised here by hand — ordered labelled sections,
  repeated/alternative ranges, perushim, article union, recitation — are
  covered deterministically by the unit suite
  (`MoedServiceTests`, `MoedUnitTextTests`, `MoedViewModelTests`,
  `MoadimListViewModelTests`, `ReaderRecitationEngineTests`).
