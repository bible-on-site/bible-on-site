# Home workspace and compact navigation

`before-header.png` is the user's captured administration header before this
change. `after-desktop.png` and `after-mobile.png` are real local Chromium E2E
captures from `tests/e2e/health.test.ts`, using a disposable loopback database.

The home route now opens Issues/PRs directly. At 1280 CSS pixels the header is
64 pixels high, with the brand and logout vertically aligned. At 390 pixels the
menu opens from its labelled button and closes after navigation. Legacy queue
URLs retain discussion IDs and filters when redirecting to home.

The `article-links-*.png` captures come from the ordinary contribution E2E flow:
manual composition, a domain diff, and deterministic discovery with the same
doradsoft review gate. Repeated discovery returns the same PR. The test verifies
that no article text or canonical link changed and closes the synthetic PRs.

The captures verify local implementation; production verification follows the
normal CI, merge and deployment workflow.

Final capture run: 2026-11-16, all 30 Chromium tests passed across six files,
with zero retries or skipped cases. This includes legacy bookmarks, the compact
desktop/mobile header, archive navigation/logout, ordinary article-link PRs,
and assigned-agent implementation plus automatic handling of human comments.
