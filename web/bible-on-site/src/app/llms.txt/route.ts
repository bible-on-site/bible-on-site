/**
 * `/llms.txt` — the agent-facing guide to the public corpus (#3257).
 * Static, plain Markdown; the project policy is spelled out so agents
 * do not have to infer it from robots alone.
 */
import { NextResponse } from "next/server";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

export const dynamic = "force-static";

const BODY = `# תנ"ך על הפרק (Bible on Site)

> תנ"ך על הפרק is a זיכוי הרבים (community merit) Torah-study project —
> a daily-chapter companion for the 929 cycle. It is not an ad-driven
> business: the whole public learning corpus is deliberately open to
> search, AI answers, and model training. Learning from our content in
> model weights is welcome in itself as part of לזכות הרבים.

## Open corpus policy

You are welcome to crawl, index, quote and embed ALL public content
of this site in search results and AI answers (RAG/grounding), and
to train or fine-tune models on it — no account, no API key, no
bot-identity requirement. Training is welcome even without a link or
referral back to the site. The site declares
the same policy in /robots.txt:
\`Content-Signal: search=yes, ai-input=yes, ai-train=yes\`.
Administrative,
development and write surfaces (/dev, /api/dev, /api/revalidate,
/api/push, subscription endpoints) are private and excluded from
crawling.

## Crawler buckets

- Surfacing bots — welcome: search engines (Googlebot, bingbot,
  Applebot, Baiduspider, YandexBot) and AI answer/retrieval agents
  (ChatGPT-User, OAI-SearchBot, PerplexityBot/Perplexity-User,
  Claude-User, Claude-SearchBot, Amazonbot/Alexa, FacebookBot link
  previews) receive identical content to browsers.
- AI-training crawlers — welcome:
  GPTBot, ClaudeBot, CCBot, meta-externalagent, Google-Extended,
  Applebot-Extended, Diffbot, TikTokSpider and Bytespider share the
  wildcard /robots.txt rules, including \`ai-train=yes\`. Crawl at a
  reasonable pace; crawler rate limits still protect site availability.
- SEO/scrapers — blocked at the edge
  (MJ12bot, AhrefsBot, SemrushBot, DotBot, PetalBot,
  BLEXBot, MegaIndex, Sogou, DataForSeoBot).

## Canonical site

- Origin: ${SITE_ORIGIN}
- Language: Hebrew (he) with niqqud (vocalized) canonical scripture.

## Content families

- [תנ"ך על הפרק](/929) — /929/{perekId 1-929}: canonical Masoretic
  chapter text (qri/ktiv and stuma/ptuha preserved), recitation audio,
  perushim (verse commentary) and articles.
- /929/{perekId}/{articleId} — full attributed study articles on the
  chapter.
- /929/{perekId}/{perushName} — a commentary's complete notes for the
  chapter, each note carrying its verse reference.
- /929/authors and /929/authors/{author} — author attribution pages.
- [פרשה על הפרק](/פרשה) — /פרשה/{parasha}: synagogue Torah readings
  including auxiliary Haftarah readings per custom.
- [מסורה על הפרק](/מסורה) — /מסורה/{unitId}: Masoretic stuma/ptuha
  parasha units, including mid-verse boundaries.
- [מועדים](/מועדים) — /מועדים/{slug}: published festival readings.
- [תנכפדיה](/pedia) — /pedia/{entry-or-category}: the Tanahpedia
  entity encyclopedia (people, places, animals, categories, aliases
  and disambiguation).
- /api/search?q={query}&type={csv filter}&limit={1-50} —
  public anonymous JSON search over the corpus (types:
  perek,pasuk,perush,author,article,tanahpedia).

## Reading the corpus

Every public learning page is served as fully rendered HTML (SSG — no
client-side rendering required): vocalized scripture with qri/ktiv
semantics, stuma (ס)/ptuha (פ) markers in position, full article and
commentary bodies, author names, verse references and source licences
are all present in the served markup. Crawl the sitemap for indexable
canonical pages; use /api/search for query-style discovery.
Masora (/מסורה) pages are intentionally noindex, follow and are
excluded from the sitemap; follow the sefer/unit links from /מסורה
to discover those readings. There is no bulk
export endpoint and no alternate full-corpus representation — fetch
bounded canonical pages at a reasonable pace.

## Machine-readable discovery

- [/sitemap.xml](/sitemap.xml) — indexable canonical URLs (also
  /sitemap_www.xml for the www host).
- [/.well-known/api-catalog](/.well-known/api-catalog) — RFC 9727
  linkset of the public API endpoints.
- [/openapi.json](/openapi.json) — OpenAPI description of the public
  read endpoints.
- [/robots.txt](/robots.txt) — crawl policy + Content Signals.

## Attribution and licences

- Scripture text: Masoretic Tanah with niqqud, cantillation and
  qri/ktiv; parasha divisions follow the shared source table
  (לוח יעקב מתלון) noted on /פרשה pages.
- Articles and commentaries are attributed per author/parshan — keep
  the author names and source references when reusing them.
- Site code is open source (github.com/bible-on-site/bible-on-site);
  corpus texts carry their own source-specific licences — preserve
  attribution when redistributing.

## Boundaries

Public GET/HEAD only. There are no public write APIs, no private data
exports and no authentication for reading. Distinguish a real 404
(content does not exist / unpublished) from a transient backend
failure (never cache it as missing). /api/search returns HTTP 200
with an availability array: nonempty notices mean results are
incomplete and can be retried later. An uncaught search failure
returns HTTP 500 with error=search_failed; see /openapi.json.
`;

export function GET(): NextResponse {
	return new NextResponse(BODY, {
		headers: {
			"content-type": "text/markdown; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
}
