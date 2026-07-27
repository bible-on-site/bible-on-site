---
description: "Website (Next.js) development, testing, and styling practices"
applyTo: "web/bible-on-site/**"
---

# Website (web/bible-on-site) Practices

## Legacy Reference

When asked to **inspire from legacy website** or reference the old website implementation, look at the `legacy-website/` directory in the repo root. This is an untracked directory containing the previous website codebase for reference.

## Development

- Use Playwright at http://localhost:3001 (`npm run dev` if needed).
- **Prefer server components for content**: content-rich (text, articles, sections) → SSG/SSR only for SEO and AIO. Use client components only for interactive/glue (navigation, animation, scroll, menu). Keep client components minimal and isolated; content should remain server-rendered.
- Parse `.env` files with `dotenv`/`dotenv-cli`, not line-based regular expressions; Windows CRLF can leave `\r` in regex matches or cause an end-of-line match to fail.
- Start specialized dev environments through their package script/local `node_modules/.bin` tool. Do not substitute `npx dotenv`, which can resolve a different package and silently fall back to the default database.
- After replacing database data used by `unstable_cache(..., { revalidate: false })`, remove the full `.next` directory and restart. Removing only `.next/cache` did not invalidate all Next.js 16 data-cache state.

## Commands

| Task | Command |
| ---- | ------- |
| Unit Tests | `npm run test:unit` |
| E2E Tests | `npm run test:e2e` |
| Unit Coverage | `npm run coverage:unit` |
| E2E Coverage | `npm run coverage:e2e` |

## Implementation Notes

- For test assertions: non-null assertion with a linter suppression comment explaining why it's safe.
- When catching errors, log with `console.warn` or `console.error`.
- For database-backed optional UI, include route/entity context in the log before returning an empty fallback; otherwise a schema failure is indistinguishable from genuinely absent content.
- For connector/layout geometry, use temporary high-contrast overlays to debug, then capture the final real colors at normal zoom on desktop and mobile. Tight clips verify junctions and full views verify composition; neither alone is sufficient.

## Styling Guidelines

- **Do not mix font families**: Use `font-family: inherit` to maintain consistency with the website's global font. Avoid introducing custom fonts (like "Lora", "Roboto", etc.) in component styles.
