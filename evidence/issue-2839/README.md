# Issue #2839 — 34-Hebrew-letter line cap, תיקון קוראים flow

## Device captures (FlaUI e2e, Windows app)

`before-tikkun-bereshit-yud.png` / `after-tikkun-bereshit-yud.png` — the app
running on Windows, בראשית י in תיקון קוראים + שניים מקרא (dark theme), captured
by `BibleOnSite.Tests.E2E` `TikkunFlowModeTests`. At this ~700px text column the
width budget already wrapped near the cap, so the visible change is subtle; the
binding case is a wider column, proven by the engine dumps below and by the
packaged-canon regression tests in `TikkunFlowLayoutTests.PackagedScripture`.

## Real-engine line dumps (שipped tanah_view data)

`lines-{narrow,wide}-{before,after}.txt` — the real `TikkunKorimTextBuilder`
word stream of בראשית י שניים מקרא run through `TikkunFlowLayout` before and
after the cap, annotated per rendered line with its Hebrew-letter count
(א-ת incl. final forms; niqqud/taamim/maqaf/punctuation count zero).

- `lines-wide-*` (1500px column — width never binds): **before** packs 59–66
  letters per line; **after** caps every line at ≤34, with many at exactly 34.
- `lines-narrow-*` (660px phone column): identical line count — the cap only
  reshapes lines whose width would otherwise admit more than 34 letters.
