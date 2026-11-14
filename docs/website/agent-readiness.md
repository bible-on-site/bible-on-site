# Agent Readiness — Open Public Corpus

Implementation of
[issue #3257](https://github.com/bible-on-site/bible-on-site/issues/3257)
and the owner's decision on PR #3299: the public learning corpus is
open for search indexing, AI answers/retrieval, and model training.
Learning from the content in model weights is welcome in itself as
part of לזכות הרבים; links or referrals are not a condition of training
permission. Administrative, private, write, and development surfaces
stay protected; source-specific licences and attribution still apply.

## Policy surfaces

| Surface | File | Content |
| ------- | ---- | ------- |
| `robots.txt` | `src/app/robots.txt/route.ts` | `Allow: /`, narrow public-read exception for `/api/search`, disallow for `/api/` and `/dev`, and Content Signals `search=yes, ai-input=yes, ai-train=yes` in the wildcard group |
| `llms.txt` | `src/app/llms.txt/route.ts` | Project purpose, open-corpus policy, crawler buckets, canonical URL families, source references, attribution and licence guidance |
| `/.well-known/api-catalog` | `src/app/.well-known/api-catalog/route.ts` | RFC 9727 linkset catalog of the public read APIs |
| `/openapi.json` | `src/app/openapi.json/route.ts` | OpenAPI description of `/api/search` and the discovery endpoints |

## Crawler buckets

Crawler access remains bucketized; both surfacing and training uses
are welcome:

- **Surfacing bots — welcome.** Search engines (Googlebot, bingbot,
  Applebot, Baiduspider, YandexBot) and AI answer/retrieval agents
  (ChatGPT-User, OAI-SearchBot, PerplexityBot/Perplexity-User,
  Claude-User, Claude-SearchBot, Amazonbot/Alexa, FacebookBot link
  previews) receive identical content to browsers, and `robots.txt`
  grants `Content-Signal: search=yes, ai-input=yes`.
- **AI-training crawlers — welcome.** `GPTBot`,
  `ClaudeBot`, `CCBot`, `meta-externalagent`, `Google-Extended`,
  `Applebot-Extended`, `Diffbot`, `TikTokSpider` and `Bytespider` share
  the wildcard public/private rules in `robots.txt`, with `ai-train=yes`.
  They receive the same public content as browsers. Crawler rate limits
  still protect site availability.
- **SEO/scrapers — blocked.** The
  `BLOCKED_BOTS`/`BOT_BLOCKING_ENABLED` denylist in `src/proxy.ts`
  stays in force (MJ12bot, AhrefsBot, SemrushBot, DotBot,
  PetalBot, BLEXBot, MegaIndex, Sogou, DataForSeoBot). Bytespider is
  removed from this denylist and joins the rate-limited AI crawlers.
- **Everything else — open.** Browsers and unknown agents receive the
  full public corpus; `ai-train=yes` applies as a declared
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
it is kept for the SEO/scraper bucket (above). Sitemap, canonical
redirects, and `next.config.mjs` headers/rewrites contain no other
crawler discrimination. The assets CDN module (`devops/assets-cdn.mjs`)
serves recording/image files and has no UA gating.

The EC2 nginx router (`docs/aws/cloudformation/ec2-nginx/router/router.conf`)
rate-limits the "crawler" UA class, including AI-training crawlers.
This PR moves Bytespider from `blocked` to `crawler`; existing per-IP
and aggregate crawler rate limits, routing, caching, DNS, and public
URLs are unchanged. The other listed training crawlers retain their
existing edge classification.

This AWS-impacting change must not be merged or activated without
Dorad's explicit approval of the current PR. Before activation, verify
the target account and current router baseline, validate the complete
installed configuration, and follow the [router validation procedure](../aws/cloudformation/ec2-nginx/router/README.md).
Monitor crawler load, health/readiness, and 403/429/503 responses.
Existing public and crawled URLs retain their content and redirects.

Rollback: restore the previous router configuration and gracefully
reload nginx after `nginx -t`; revert the policy commit and redeploy
the previous website version to restore its robots, guide, and proxy
rules. Training data already collected cannot be recalled by changing
crawl directives.
