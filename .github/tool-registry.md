# Tool Registry

Tracks researched tools. Check before first use, update after research.

| Tool | Version | Date | Key Learnings |
|------|---------|------|---------------|
| sqlite3 | 3.51.1 | 2026-01-03 | Path: `%LOCALAPPDATA%\Microsoft\WinGet\Packages\SQLite.SQLite_Microsoft.Winget.Source_8wekyb3d8bbwe\sqlite3.exe`. Installed via WinGet. Use for querying SQLite databases. |
| icu_calendar | 2.1.1 | 2025-07-01 | Unicode-3.0 license (permissive). Hebrew calendar: `Date::try_new_iso(y,m,d).to_calendar(Hebrew::new())`. Access: `extended_year()`, `month().ordinal` (1-13), `day_of_month().0`. Months start from Tishrei. Leap years have 13 months (Adar I at ordinal 6, Adar II at 7). |
| Biome | 2.5.5 | 2026-07-25 | Keep `$schema` aligned with the installed CLI. Use `linter.rules.preset: "recommended"`; top-level `linter.rules.recommended` is deprecated. |
| Vite | 7.3.6 | 2026-07-25 | This release does not expose `resolve.tsconfigPaths`; use an absolute `resolve.alias` (for example with `fileURLToPath`) instead of `vite-tsconfig-paths` and its deprecated `tsconfck` dependency. |
| Next.js | 16.2.12 | 2026-07-26 | Stable Turbopack builds no longer reproduce the `incrementalCacheHandler` import-injection regression from 16.2.0-16.2.9. For standalone tracing, production-alias development-only subprocess modules to filesystem-free stubs; `turbopackIgnore` comments do not prevent NFT from tracing local binaries. |
