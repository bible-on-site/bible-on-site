# Tool Registry

Tracks researched tools. Check before first use, update after research.

| Tool | Version | Date | Key Learnings |
|------|---------|------|---------------|
| Node.js | 26.10.0 | 2026-09-29 | Current release; use the same version in `.nvmrc`, npm engine ranges, Docker images, and CI lockfile checks. The official Windows zip provides a portable npm 11.19.1 for local validation. [Release](https://nodejs.org/en/blog/release/v26.10.0). |
| Rust | 1.98.1 | 2026-09-29 | Stable point release fixes a 1.98.0 vtable miscompilation; use it for API and bulletin Docker builds and Rust workspace checks. [Release](https://blog.rust-lang.org/2026/09/03/Rust-1.98.1/). |
| TypeScript | 7.0.2 | 2026-09-29 | Admin and website type checks pass after regenerating stale Next route types; the admin bundler warning types now come from Rolldown. |
| Vitest | 5.0.2 | 2026-09-29 | Admin's 300 unit tests pass under Node 26 with matching `@vitest/coverage-v8` 5.0.2. |
| sqlite3 | 3.51.1 | 2026-01-03 | Path: `%LOCALAPPDATA%\Microsoft\WinGet\Packages\SQLite.SQLite_Microsoft.Winget.Source_8wekyb3d8bbwe\sqlite3.exe`. Installed via WinGet. Use for querying SQLite databases. |
| icu_calendar | 2.1.1 | 2025-07-01 | Unicode-3.0 license (permissive). Hebrew calendar: `Date::try_new_iso(y,m,d).to_calendar(Hebrew::new())`. Access: `extended_year()`, `month().ordinal` (1-13), `day_of_month().0`. Months start from Tishrei. Leap years have 13 months (Adar I at ordinal 6, Adar II at 7). |
| Biome | 2.5.14 | 2026-09-29 | Keep `$schema` aligned with the installed CLI. Use `linter.rules.preset: "recommended"`; top-level `linter.rules.recommended` is deprecated. |
| Vite | 8.3.1 | 2026-09-29 | Admin builds with Rolldown; import warning types from `rolldown` rather than `rollup`. Keep the absolute `resolve.alias` for `~`. |
| Next.js | 16.3.6 | 2026-09-29 | Website compilation and type checking pass with Node 26. For standalone tracing, production-alias development-only subprocess modules to filesystem-free stubs; `turbopackIgnore` comments do not prevent NFT from tracing local binaries. |
| RustFS | 1.0.0 | 2026-09-27 | Official multi-platform image `rustfs/rustfs`; Apache-2.0, no license activation. Container UID 10001, named volume at `/data`; credentials use `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY`. `/health/ready` waits for storage/IAM; `/health` is liveness only. Standard S3 bucket policies enable anonymous GetObject. Share digest-pinned Compose configuration between local development and CI; never reuse the MinIO volume directly. [Docker guide](https://docs.rustfs.com/en/installation/container/docker), [health probes](https://docs.rustfs.com/en/operations/status-check). |
