---
description: "Flip book (html-flip-book) integration and local dev workflow"
applyTo: "web/bible-on-site/**/929/**, **/Sefer*.tsx, **/FlipBook*, **/copy-local-flip-book*"
---

# Flip Book Integration

## Local dev

Build in `html-flip-book` (`npm run build`), then from `web/bible-on-site` run `USE_LOCAL_FLIP_BOOK=1 npm run postinstall` to copy that build into `node_modules`. CI/production use the **published** `html-flip-book-react`; the copy script runs only with `USE_LOCAL_FLIP_BOOK=1` or a `file:` dependency.

## Publishing

Never `npm publish` or create a GitHub Release manually — merging to master auto-releases and auto-publishes (details in `html-flip-book/.cursor/rules/ci-cd.mdc`).

## After library changes

`bible-on-site` CI passes only once the new package is on npm: merge the library first, then bump here — updating **both** `html-flip-book-react` in `package.json` and `NPM_VERSION` in `scripts/toggle-flip-book-dep.mjs`.
