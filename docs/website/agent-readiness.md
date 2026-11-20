# Agent Readiness - Open Public Corpus

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
| `robots.txt` | `src/app/robots.txt/route.ts` | `Allow: /`, narrow public-read exceptions for `/api/search` and `/api/health`, disallow for `/api/` and `/dev`, Content Signals `search=yes, ai-input=yes, ai-train=yes` in the wildcard group, and the `Agentmap:` ARD-manifest hint parked in a comment - a live directive would fail strict robots.txt validation (Lighthouse's `robots-txt` audit caps the SEO score below the required 100%) |
| `llms.txt` | `src/app/llms.txt/route.ts` | Project purpose, open-corpus policy, crawler buckets, canonical URL families, source references, attribution and licence guidance |
| `/.well-known/api-catalog` | `src/app/.well-known/api-catalog/route.ts` | RFC 9727 linkset catalog of the public read APIs |
| `/openapi.json` | `src/app/openapi.json/route.ts` | OpenAPI description of `/api/search` and the discovery endpoints |
| `/.well-known/ard.json` + `/.well-known/ai-catalog.json` | `src/lib/ai-catalog.ts`, `src/app/.well-known/ard.json/route.ts`, `src/app/.well-known/ai-catalog.json/route.ts` | ARD v0.91 / AI Catalog capability manifest (`application/ard+json` / `application/ai-catalog+json`) listing only the agent-facing artifacts this origin really serves; advertised via `<link rel="ard"/"ai-catalog">` in page head, a `Link` header and an `Agentmap:` comment in robots.txt |
| `/.well-known/agent-skills/index.json` + `/{name}/SKILL.md` | `src/lib/agent-skills.ts`, `src/app/.well-known/agent-skills/` | Agent Skills discovery index v0.2.0 with sha256 digests, and three `skill-md` artifacts (`tanah-corpus-map`, `tanah-corpus-search`, `tanah-corpus-citation`) that teach correct traversal, search and citation of the corpus |
| `/auth.md` | `src/app/auth.md/route.ts` | Honest anonymous-access note: no registration, keys or OAuth exist for public reads |

## Crawler buckets

Crawler access remains bucketized; both surfacing and training uses
are welcome:

- **Surfacing bots - welcome.** Search engines (Googlebot, bingbot,
  Applebot, Baiduspider, YandexBot) and AI answer/retrieval agents
  (ChatGPT-User, OAI-SearchBot, PerplexityBot/Perplexity-User,
  Claude-User, Claude-SearchBot, Amazonbot/Alexa, FacebookBot link
  previews) receive identical content to browsers, and `robots.txt`
  grants `Content-Signal: search=yes, ai-input=yes`.
- **AI-training crawlers - welcome.** `GPTBot`,
  `ClaudeBot`, `CCBot`, `meta-externalagent`, `Google-Extended`,
  `Applebot-Extended`, `Diffbot`, `TikTokSpider` and `Bytespider` share
  the wildcard public/private rules in `robots.txt`, with `ai-train=yes`.
  They receive the same public content as browsers. Crawler rate limits
  still protect site availability.
- **SEO/scrapers - blocked.** The
  `BLOCKED_BOTS`/`BOT_BLOCKING_ENABLED` denylist in `src/proxy.ts`
  stays in force (MJ12bot, AhrefsBot, SemrushBot, DotBot,
  PetalBot, BLEXBot, MegaIndex, Sogou, DataForSeoBot). Bytespider is
  removed from this denylist and joins the rate-limited AI crawlers.
- **Everything else - open.** Browsers and unknown agents receive the
  full public corpus; `ai-train=yes` applies as a declared
  signal.

Canonicalization (Tanahpedia/parasha aliases) and the parasha
view-param `noindex` handling are unchanged.

## Reading the corpus

Every public learning page is served as fully rendered HTML
(SSG - no client rendering required); scripture qri/ktiv,
stuma/ptuha markers, footnotes, verse references and source licences
are present in the served markup. The sitemap lists indexable
canonical URLs; Masora (`/מסורה`) pages are intentionally
`noindex, follow` and excluded. Follow the sefer/unit links from
`/מסורה` to discover those readings. `/api/search` provides anonymous
JSON query access. Its HTTP 200 responses include an `availability`
array: nonempty notices mean results are incomplete and may be
retried later. Uncaught search failures return HTTP 500 with
`error=search_failed`; invalid parameters return 400, or 414 for an
overlong query. The OpenAPI document describes this existing contract.

**No alternate whole-corpus representation.** A Markdown mirror of
every corpus page (the earlier `/md/*` route + `Accept: text/markdown`
negotiation) was removed per the PR #3299 review: duplicating gigs of
textual content as a second representation is not acceptable while
the SSG surface is already heavy. Agents read the same HTML readers
get, discovered through the sitemap and `/api/search`.

## HTTP semantics

- HTML responses on public GET/HEAD requests advertise `Link:
  </llms.txt>; rel="help"`,
  `</.well-known/api-catalog>; rel="api-catalog"`,
  `</.well-known/ard.json>; rel="ard"` and
  `</sitemap.xml>; rel="sitemap"`. The API catalog supplies its own
  canonical Link header and bypasses proxy discovery headers, because
  Next.js does not merge a handler's Link header with the proxy's.
  Every page head also carries `<link rel="ard">` and
  `<link rel="ai-catalog">` for agents that parse markup rather than
  headers.
  Writes/POSTs (incl. Server Actions) never get discovery headers.
- Alias redirects (`/tanahpedia/*`, `/parasha/*`, Hebrew parasha slug
  variants) stay 308s; Tanahpedia filter params are consumed into the
  canonical slug and dropped, as before.
- Confirmed missing/unpublished content is `404`; transient backend
  failures surface as retryable errors, never a cached false-404.

## Cloudflare Agent Readiness findings

Real scan of the production origin (`https://xn--febl3a.co.il`) through
the public `isitagentready.com` scanner API, 2026-11-16 - result
**level 2 "Bot-Aware"** after #3299 deployed (a pre-#3299 "before" is not
reproducible; that is the recorded baseline). Outcomes below carry their
disposition; per the issue, no nonexistent capability is advertised to
inflate the score.

### Passing checks

| Check | Evidence |
| ----- | -------- |
| `robotsTxt` | valid `robots.txt` (200, `text/plain`) |
| `sitemap` | valid `sitemap.xml` declared from robots |
| `linkHeaders` | agent-useful Link relations found (`api-catalog`) |
| `robotsTxtAiRules` | no AI-specific bot rules; wildcard rules apply to AI bots |
| `contentSignals` | `search=yes, ai-input=yes, ai-train=yes` parsed |
| `apiCatalog` | RFC 9727 catalog found with 1 API listed |

### Neutral / unscored checks

`webBotAuth` (informational - Web Bot Auth signatures need edge signing
infrastructure the site does not run) and the commerce checks (`x402`,
`mpp`, `ucp`, `acp`, `ap2`), which do not apply - this is not a commerce
site.

### Failing checks and their disposition

| Check | Disposition |
| ----- | ----------- |
| `markdownNegotiation` | **Deliberate gap.** A whole-corpus Markdown mirror was removed per the owner's PR #3299 review - duplicating gigabytes of textual content as a second representation is not acceptable while the SSG surface is already heavy. Agents read the same fully-rendered HTML readers get. |
| `dnsAid` | Requires `_index._agents`/related DNS records - an infrastructure (DNS) change outside the website diff; per the issue it needs Dorad's explicit approval like any AWS/edge change. Not implemented here. |
| `ard` | **Fixed in this increment** - `/.well-known/ard.json` + `/.well-known/ai-catalog.json` manifest, an `Agentmap:` robots.txt comment and `<link rel="ard"/"ai-catalog">` head links. |
| `agentSkills` | **Fixed in this increment** - `/.well-known/agent-skills/index.json` + three real SKILL.md artifacts. |
| `authMd` | **Fixed in this increment** - `/auth.md` states honestly that no authentication exists for public reads. |
| `oauthDiscovery`, `oauthProtectedResource` | Not applicable - public reads are anonymous; publishing OAuth metadata for a nonexistent auth server would be a fake capability. |
| `mcpServerCard`, `a2aAgentCard`, `webMcp`, `personalAgentProtocol` | Not applicable - the site runs no MCP server, A2A agent, in-page tools or personal-agent endpoint; cards must not be fabricated. |

Re-run the scanner after deploy to confirm the fixed rows flip; the DNS
row can only move with an approved infrastructure change.

## Edge / proxy audit

Application layer: the proxy denylist is the only UA-based blocking -
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
