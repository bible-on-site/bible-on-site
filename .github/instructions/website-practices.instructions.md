---
description: "Website (Next.js) development, testing, and styling practices"
applyTo: "web/bible-on-site/**"
---

# Website (web/bible-on-site) Practices

## Legacy Reference

"Inspire from legacy website" = the untracked `legacy-website/` directory in the repo root.

## Development

- Drive Playwright against http://localhost:3001 (`npm run dev` if needed).
- **Server components by default.** Content (text, articles, sections) stays server-rendered for SEO/AIO; client components are only interaction glue (navigation, animation, scroll, menu) and stay minimal and isolated.
- **Routes are static by default.** A route may be dynamic only for a real production reason (e.g. a per-request redirect). Never force a route dynamic — or otherwise weaken production rendering — to dodge local staleness; `next dev` re-renders per request, so local problems stay local. Check the route table in `npm run build` output after touching rendering.
- Parse `.env` files with `dotenv`/`dotenv-cli`, never line-based regexes — Windows CRLF leaves `\r` in matches or breaks end-of-line matching.
- Line endings are LF everywhere (root `.gitattributes`: `* text=auto eol=lf`), matching the LF blobs and CI. Lint with `npm run lint` (`biome lint`) only — never `biome check` or `biome format --write`: Biome is a linter here, not a formatter/import-sorter, and those commands re-sort imports and reflow code the repo does not enforce.
- Start specialized dev environments through their package script or local `node_modules/.bin`; `npx dotenv` can resolve a different package and silently fall back to the default database.
- After replacing data behind `unstable_cache(..., { revalidate: false })`, delete the whole `.next` directory and restart — clearing `.next/cache` alone does not invalidate Next.js 16 data-cache state.

## Commands

| Task          | Command                 |
| ------------- | ----------------------- |
| Unit Tests    | `npm run test:unit`     |
| E2E Tests     | `npm run test:e2e`      |
| Unit Coverage | `npm run coverage:unit` |
| E2E Coverage  | `npm run coverage:e2e`  |

## Implementation Notes

- Test assertions: non-null assertion plus a suppression comment explaining why it is safe.
- Log caught errors with `console.warn`/`console.error`; for database-backed optional UI include route/entity context before the empty fallback, so a schema failure is distinguishable from absent content.
- For connector/layout geometry, debug with temporary high-contrast overlays, then verify real colors at normal zoom on desktop and mobile — tight clips prove junctions, full views prove composition.

## Styling Guidelines

**Never mix font families**: use `font-family: inherit`; no custom fonts (Lora, Roboto, …) in component styles.
