# Evidence — #3731 drawer reorganization + #3732 browser reminder preference

Captures taken with Playwright/Chromium against production
(`xn--febl3a.co.il`) for the "before" shots and this branch's standalone
production build for the "after" shots, at 1440px desktop viewport unless
noted.

## What each file shows

| File | Content |
| --- | --- |
| `before-drawer.png` / `after-drawer.png` | The hamburger navigation drawer. Before: flat destination list. After: the five Hebrew groups with per-item subtitles and the three store links nested under יישומון (#3731). |
| `before-drawer-mobile.png` / `after-drawer-mobile.png` | Same drawer on a 390px viewport — subtitles wrap and stay readable within the click target. |
| `before-bulletin.png` / `after-bulletin.png` | The daily-bulletin section. After adds the dedicated דפדפן card (`#bulletin-push`) alongside Telegram / WhatsApp / email with separate הפעלת התראות and ביטול התראות controls (#3732). |
| `before-app.png` / `after-app.png` | The app section: the old reminder checkbox is removed; the reminder moved to the dedicated bulletin card (#3732). |
| `before-reader-settings.png` / `after-reader-settings.png` | The על הפרק reader settings dropdown gains the התראה יומית בדפדפן preference checkbox (#3732). |

## Capture method

Standalone `next build` + `next start` on a local port, driven by
Playwright (`capture-tmp.mjs`, not committed). "Before" shots are the live
production site; "after" shots are this branch's build.
