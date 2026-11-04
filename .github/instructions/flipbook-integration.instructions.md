---
description: "Flip book (html-flip-book) integration and local dev workflow"
applyTo: "web/bible-on-site/**/929/**, **/Sefer*.tsx, **/FlipBook*, **/copy-local-flip-book*"
---

# Flip Book Integration

## Local dev

Build in `html-flip-book` (`bun run build`), then from `web/bible-on-site` run `USE_LOCAL_FLIP_BOOK=1 bun run postinstall` to copy that build into `node_modules`. CI/production use the **published** `html-flip-book-react`; initial copying requires `USE_LOCAL_FLIP_BOOK=1` or a `file:` dependency. An active copied override records its source checkout; subsequent `bun run build` calls refresh it automatically before compiling the reader, including when the source is a separate worktree. `USE_LOCAL_FLIP_BOOK=0` disables that override, and `bun run flip-book:npm` restores the registry files.

## Publishing

Never `npm publish` or create a GitHub Release manually — merging to master auto-releases and auto-publishes (details in `html-flip-book/.cursor/rules/ci-cd.mdc`).

## After library changes

`bible-on-site` CI passes only once the new package is on npm: merge the library first, then bump here — updating **both** `html-flip-book-react` in `package.json` and `NPM_VERSION` in `scripts/toggle-flip-book-dep.mjs`.
