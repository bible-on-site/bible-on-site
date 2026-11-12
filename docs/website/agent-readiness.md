# Agent Readiness — Open Public Corpus

Implementation of
[issue #3257](https://github.com/bible-on-site/bible-on-site/issues/3257)
as scoped by the PR #3299 review: the public learning corpus is open
to crawlers and agents that **surface** it — search indexing and
AI answers/retrieval (זיכוי הרבים, not an ad-driven business).
Non-surfacing bots are bucketized pending the owner's per-bucket
decision; administrative, private, write, and development surfaces
stay protected.

## Policy surfaces

| Surface | File | Content |
| ------- | ---- | ------- |
| `robots.txt` | `src/app/robots.txt/route.ts` | `Allow: /`, narrow public-read exception for `/api/search`, disallow for admin/dev/write paths, Content Signals `search=yes, ai-input=yes, ai-train=no`, and an explicit `Disallow: /` group for the withheld AI-training bucket |
| `llms.txt` | `src/app/llms.txt/route.ts` | Project purpose, open-corpus policy, crawler buckets, canonical URL families, source references, attribution and licence guidance |
| `/.well-known/api-catalog` | `src/app/.well-known/api-catalog/route.ts` | RFC 9727 linkset catalog of the public read APIs |
| `/openapi.json` | `src/app/openapi.json/route.ts` | OpenAPI description of `/api/search` and the discovery endpoints |

## Crawler buckets

Per the PR #3299 review, crawler access is bucketized rather than
blanket-open — only surfacing bots are graced:

- **Surfacing bots — welcome.** Search engines (Googlebot, bingbot,
  Applebot, Baiduspider, YandexBot) and AI answer/retrieval agents
  (ChatGPT-User, OAI-SearchBot, PerplexityBot/Perplexity-User,
  Claude-User, Claude-SearchBot, Amazonbot/Alexa, FacebookBot link
  previews) receive identical content to browsers, and `robots.txt`
  grants `Content-Signal: search=yes, ai-input=yes`.
- **AI-training-only crawlers — withheld.** `User-agent: GPTBot`,
  `ClaudeBot`, `CCBot`, `meta-externalagent`, `Google-Extended`,
  `Applebot-Extended`, `Diffbot` and `TikTokSpider` carry an explicit
  `Disallow: /` in `robots.txt`, and `ai-train=no` is declared for
  all — pending the owner's per-bucket decision. Admitting any of
  them is a one-line change once decided.
- **Pure-harvest SEO/scrapers — blocked.** The pre-existing
  `BLOCKED_BOTS`/`BOT_BLOCKING_ENABLED` denylist in `src/proxy.ts`
  stays in force (Bytespider, MJ12bot, AhrefsBot, SemrushBot, DotBot,
  PetalBot, BLEXBot, MegaIndex, Sogou, DataForSeoBot): these agents
  never surfaced the content and ignore robots directives, so they
  are blocked at the edge (HTTP 403).
- **Everything else — open.** Browsers and unknown agents receive the
  full public corpus; `ai-train=no` still applies as a declared
  signal.

Canonicalization (Tanahpedia/parasha aliases) and the parasha
view-param `noindex` handling are unchanged.

## Reading the corpus

Every public learning page is served as fully rendered HTML
(SSG — no client rendering required); scripture qri/ktiv,
stuma/ptuha markers, footnotes, verse references and source licences
are present in the served markup. The sitemap is the complete
canonical URL index; `/api/search` provides anonymous JSON query
access.

**No alternate whole-corpus representation.** A Markdown mirror of
every corpus page (the earlier `/md/*` route + `Accept: text/markdown`
negotiation) was removed per the PR #3299 review: duplicating gigs of
textual content as a second representation is not acceptable while
the SSG surface is already heavy. Agents read the same HTML readers
get, discovered through the sitemap and `/api/search`.

## HTTP semantics

- HTML responses on public GET/HEAD requests advertise `Link:
  </llms.txt>; rel="help"`,
  `</.well-known/api-catalog>; rel="api-catalog"` and
  `</sitemap.xml>; rel="sitemap"` (appended — per-route Link headers
  survive intact). Writes/POSTs (incl. Server Actions) never get them.
- Alias redirects (`/tanahpedia/*`, `/parasha/*`, Hebrew parasha slug
  variants) stay 308s; Tanahpedia filter params are consumed into the
  canonical slug and dropped, as before.
- Confirmed missing/unpublished content is `404`; transient backend
  failures surface as retryable errors, never a cached false-404.

## Edge / proxy audit

Application layer: the proxy denylist is the only UA-based blocking —
it is kept for the pure-harvest bucket (above). Sitemap, canonical
redirects, and `next.config.mjs` headers/rewrites contain no other
crawler discrimination. The assets CDN module (`devops/assets-cdn.mjs`)
serves recording/image files and has no UA gating.

The EC2 nginx router (`docs/aws/cloudformation/ec2-nginx/router/router.conf`)
rate-limits a "crawler" UA class that still includes the withheld
AI-training bucket — its comments are updated to match this document.
Reclassifying those agents to `blocked` at the edge is a live AWS
change queued on the same owner decision; it requires Dorad's
explicit approval per repository policy and is not part of this PR.
