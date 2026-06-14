# Deferred Dependency Upgrades

This document tracks dependency upgrades that were intentionally **not** applied
during the 2026-06 maintenance pass, why, and their current status. It is split
into two categories:

1. **Blocked** — held because of a reported breakage that must be resolved
   upstream (or by the repo owner) before the upgrade is safe.
2. **Deferred majors** — large, breaking-change framework upgrades held back from
   the conservative dependency-refresh PRs to keep them reviewable. These are
   being worked through in dedicated PRs.

---

## 1. Blocked upgrades (awaiting upstream / owner)

| Package | Module | Held at | Target | Tracking | Reason |
| --- | --- | --- | --- | --- | --- |
| `next` | web/bible-on-site | 16.1.6 | 16.2.x / 16.3 | [#1634](https://github.com/bible-on-site/bible-on-site/issues/1634) | 16.2.x Turbopack build regression (`Invariant: Expected to inject all imports … incrementalCacheHandler`). Upstream fix vercel/next.js#86630 not yet in a stable release. |
| `sunrise-sunset-js` | web/bible-on-site | 3.2.0 | 3.3.0 | [#1636](https://github.com/bible-on-site/bible-on-site/issues/1636) | 3.3.0 changes `getTwilight`/`civilDusk` so the tzeit-aware Hebrew date no longer advances after nightfall under UTC (CI). Needs the tzeit/Hebrew-date logic made timezone-robust first. |
| `swc-plugin-coverage-instrument` | web/bible-on-site | 0.0.32 | latest | [#528](https://github.com/bible-on-site/bible-on-site/issues/528) | Tightly coupled to the Next.js version; bumping in lockstep with Next is required. Currently the latest compatible with Next 16.1.x. |

These are **hard blocks**: applying them re-introduces a known, reproduced
failure. They remain held via `renovate.json` and `.github/dependabot.yml`
until the upstream/first-party fix lands.

---

## 2. Deferred framework majors (being worked through)

### web/admin

| Package | From | To | Status |
| --- | --- | --- | --- |
| `vite` | 7 | 8 | **done** ([chore/admin-majors](https://github.com/bible-on-site/bible-on-site)) |
| `vitest` | 3 | 4 | **done** (config moved to `vitest/config` `defineConfig`) |
| `@vitejs/plugin-react` | 4 | 6 | **done** |
| `@vitest/coverage-v8` | 3 | 4 | **done** |
| `@tiptap/*` | 2 | 3 | **done** (StarterKit v3 now bundles `Link`/`Underline`; removed the separate `@tiptap/extension-link` dep and configured `link` via `StarterKit.configure`) |
| `uuid` | 11 | 14 | **done** |
| `dotenv-cli` | 7 | 11 | **done** |

### data

| Package | From | To | Status |
| --- | --- | --- | --- |
| `bson` | 2 | 3 | attempting |
| `sqlx` (`sqlx-core`, `sqlx-mysql`) | 0.8 | 0.9 | attempting |
| `rusqlite` | 0.38 | 0.40 | attempting |

---

## 3. Already completed (for reference)

- **web/bible-on-site**: TypeScript 5.9 → **6.0**, jest-junit 16 → **17**
  (with a `src/types/assets.d.ts` shim for the TS6 `TS2882` CSS side-effect
  import requirement).
- **web/admin**: TypeScript 5.9 → **6.0** (via `ignoreDeprecations: "6.0"` for
  the deprecated `baseUrl`).
- All conservative (non-major) dependency refreshes across website, admin,
  devops, api, data, bulletin.
</content>
