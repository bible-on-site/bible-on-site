# Agent Readiness — Open Public Corpus

Implementation of
[issue #3257](https://github.com/bible-on-site/bible-on-site/issues/3257):
the public learning corpus is explicitly open to crawlers, agents and
AI systems that surface it — indexing and retrieval input
(זיכוי הרבים, not an ad-driven business). Model training is withheld
pending a per-bucket decision; administrative, private, write, and
development surfaces stay protected.

## Policy surfaces

| Surface | File | Content |
| ------- | ---- | ------- |
| `robots.txt` | `src/app/robots.txt/route.ts` | `Allow: /`, narrow public-read exception for `/api/search`, disallow for admin/dev/write paths, and Content Signals `search=yes, ai-input=yes, ai-train=no` (surfacing uses granted; training withheld pending per-bucket policy decision) |
| `llms.txt` | `src/app/llms.txt/route.ts` | Project purpose, open-corpus policy, canonical URL families, source references, attribution and licence guidance |
| `/.well-known/api-catalog` | `src/app/.well-known/api-catalog/route.ts` | RFC 9727 linkset catalog of the public read APIs |
| `/openapi.json` | `src/app/openapi.json/route.ts` | OpenAPI description of `/api/search` and the Markdown surface |

## Crawler buckets

Per the PR #3299 review, crawler access is bucketized rather than
blanket-open:

- **Surfacing bots — welcome.** Search engines and AI answer/retrieval
  agents receive identical content to browsers, and `robots.txt`
  grants `Content-Signal: search=yes, ai-input=yes`.
- **Training — withheld.** `ai-train=no` until a per-bucket policy
  decision is made; flipping it to `yes` is a one-word change once
  approved.
- **Pure-harvest SEO/scrapers — blocked.** The pre-existing
  `BLOCKED_BOTS`/`BOT_BLOCKING_ENABLED` denylist in `src/proxy.ts`
  stays in force (Bytespider, MJ12bot, AhrefsBot, SemrushBot, DotBot,
  PetalBot, BLEXBot, MegaIndex, Sogou, DataForSeoBot): these agents
  never surfaced the content and remain excluded pending the same
  decision.
- **Everything else — open.** Browsers, AI crawlers not in the
  denylist, and unknown agents receive the full public corpus.

Canonicalization (Tanahpedia/parasha aliases) and the parasha
view-param `noindex` handling are unchanged.

## Markdown representations

Every canonical corpus URL has two discovery paths:

- `Accept: text/markdown` on the canonical URL itself — the proxy
  rewrites to the internal `/md/*` route only when Markdown is strictly
  preferred over HTML (`src/lib/markdown/accept.ts`); `*/*` and ties
  stay HTML.
- An explicit `.md` suffix (`/929/1.md`, `/pedia/אברהם.md`) for clients
  that cannot negotiate headers.

`src/lib/markdown/paths.ts` is a pure allowlist mapping canonical route
families to document kinds — anything off-corpus (`/api/*` other than
through the public search document, `/dev/*`, management paths,
arbitrary files) resolves to `null` and 404s; the Markdown surface can
never reach off-corpus data. `src/lib/markdown/render.ts` loads through
the same content services the HTML pages use — no URL fetchers, no
self-scraping.

Corpus coverage: `/` index, `/929` index, all 929 perakim, articles,
perushim, authors index + author pages, `/פרשה` + all parashiot with
auxiliary Haftarot, `/מסורה` + units (Hebrew and ASCII spellings),
`/מועדים` + published moadim, `/pedia` + entries + categories +
synonym disambiguation. Scripture rendering
(`src/lib/markdown/scripture.ts`) prints qri, preserves orphan ktiv
with a `[כתיב: …]` marker, and emits `(ס)`/`(פ)` at exact segment
positions; segment-aware range slices never print out-of-range sides
of a pasuk.

## HTTP semantics

- `GET` and `HEAD` are both implemented on every new route handler.
- HTML responses on corpus paths advertise `Link:
  <….md>; rel="alternate"; type="text/markdown"` plus `llms.txt`
  (`rel="help"`) and the API catalog (`rel="api-catalog"`), and carry
  `Vary: Accept`; Markdown responses mirror the HTML alternate.
- Alias redirects (`/tanahpedia/*`, `/parasha/*`, Hebrew parasha slug
  variants) are 308s that carry the `.md` suffix forward so agents
  keep their format; Tanahpedia filter params are consumed into the
  canonical slug and dropped, as before.
- Confirmed missing/unpublished content is `404 no-store`; transient
  backend failures are `503` + `Retry-After` + `no-store`, never a
  cached empty document, and never leak backend details.
- Link-header paths are URI-encoded (header values are ByteString);
  the Markdown body keeps readable Hebrew.

## Edge / proxy audit

Application layer: the proxy denylist is the only UA-based blocking —
it is kept for the pure-harvest bucket (above). Sitemap, canonical
redirects, and `next.config.mjs` headers/rewrites contain no other
crawler discrimination. The assets CDN module (`devops/assets-cdn.mjs`)
serves recording/image files and has no UA gating. Any live
AWS/WAF/CloudFront rule sits outside this repo; nothing was changed
there and any such change requires Dorad's explicit approval per
repository policy.
