# Evidence — #3261 Native מועדים על הפרק reader

Captures from the Windows unpackaged debug build
(`net11.0-windows10.0.19041.0/win-x64/BibleOnSite.exe`), driven through UI
Automation (`UIAutomationClient` from PowerShell) against the live app data
directory. The flyout nav pane is pinned open on wide windows, so the
catalogue/reader captures also show the pinned pane with the
מועדים על הפרק destination in its selected state.

## Flyout and reader validation

The Android flyout on 2026-10-31 placed רבנים immediately after פרשה על הפרק.
Windows validation covered the added מועדים destination, catalogue and reader.

| Screen | Result |
| --- | --- |
| Flyout | The shared flyout opens on the catalogue page. The **מועדים על הפרק / קריאות לימוד למועדים** destination sits between פרשה על הפרק and רבנים and is highlighted as the current page. |
| Catalogue | `MoadimListPage` (`AutomationId=MoadimMenuButton`) groups published moadim by Hebrew month, including תשרי (ראש השנה, יום כיפור), ללא חודש (שבת שובה), and אב (תשעה באב). Each row shows the moed name and date label. |
| Reader | `MoedPage` for ראש השנה shows the heading, date label (א-ב בתשרי), and summary (יום הזיכרון והתקיעה). The **קריאת תורה - יום ראשון** section shows its source reference (בראשית כא א-י), the canonical perek header בראשית כא, and the resolved pesukim using the shared reader controls. |

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
