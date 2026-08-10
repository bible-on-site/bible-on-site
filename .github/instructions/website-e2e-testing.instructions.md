---
description: "Website e2e testing prerequisites, commands, and coverage mode"
applyTo: "web/bible-on-site/tests/e2e/**, web/bible-on-site/playwright*.config.ts"
---

# Website E2E Testing

## Prerequisites

MySQL must run locally (Windows service, port 3306); `launch-e2e-server.mts` populates it via `cargo make mysql-populate` and starts the server.

- **Stale server**: `reuseExistingServer: true` silently reuses anything already on port 3001 — kill leftovers before re-running.
- **Standalone**: `next start` does not work with `output: "standalone"`; the launcher uses `node .next/standalone/server.js` (production) and `next dev` (coverage).

## Commands

| Command | Server | Notes |
|---|---|---|
| `npm run test:e2e` | standalone (production) | needs `npm run build` first |
| `npm run coverage:e2e` | `next dev` + SWC instrumentation | no build needed |
| `npm run coverage:all` | unit + e2e + merge | merges LCOV |

## Coverage

Non-production mode enables the SWC plugin automatically, and global setup warms key routes (`/`, `/929`, `/929/1`) to stabilize runs. E2E LCOV lands in `.coverage/e2e/lcov.info`; `coverage:merge` combines unit + e2e into `.coverage/merged/lcov.info`.
