---
description: "Project context, terminology, and code quality standards"
applyTo: "**"
---

# Implementation Context

## Project

Jewish Orthodox project: avoid Christian terminology and reformist expressions. Perakim division is still used (not Parashot).

## Terminology

| Use | Not |
| --- | --- |
| Tanah | Bible |
| Sefer (pl. Sefarim) | Book |
| Perek (pl. Perakim) | Chapter |
| Pasuk (pl. Pesukim) | Verse |

Sefer "additionals" (e.g. שמואל א/ב): Hebrew names in code, "Additional" in UI. Full table: `docs/practices/implementation.md`.

## Code Quality

**Never ignore a compiler or linter error/warning** (TypeScript, Clippy, .NET, Biome, ESLint): keep 0 errors and 0 warnings. After every fix, run the build/lint for the changed area (`dotnet build`, `npm run build`/`npm run lint`) and clear what it reports.

**Only known exceptions**, both in `.github/workflows/ci.yml`: "Context access might be invalid: module_changed" and "Unable to find reusable workflow".
