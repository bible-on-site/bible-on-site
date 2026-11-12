/**
 * `/robots.txt` — crawl policy + AI Content Signals (issue #3257).
 * Serialized as a plain route handler because `MetadataRoute.Robots`
 * cannot emit the `Content-Signal` directive — the signal must live
 * inside a `User-agent: *` group to be valid (contentsignals.org).
 *
 * Policy (PR #3299 review): the corpus is graced only for crawlers
 * that surface it — search engines and AI agents that index the
 * content or answer user questions with it (search, ai-input).
 * Non-surfacing bots are bucketized for the owner's decision:
 * - AI-training-only crawlers get an explicit `Disallow: /` group
 *   below (and `ai-train=no` in the wildcard group);
 * - the pre-existing pure-harvest SEO/scraper bucket is hard-blocked
 *   upstream in `src/proxy.ts` (those agents ignore robots anyway).
 *
 * The named answer-side siblings of the withheld training crawlers
 * (ChatGPT-User, OAI-SearchBot, Claude-User, Claude-SearchBot,
 * PerplexityBot, Amazonbot/Alexa, Applebot for Siri/Spotlight,
 * FacebookBot link previews) stay welcome under the wildcard group.
 */
import { NextResponse } from "next/server";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

export const dynamic = "force-static";

const BODY = `# תנ"ך על הפרק is a זיכוי הרבים project: the public learning
# corpus is open to crawlers that surface it — indexing it for
# search or answering user questions with it.
# Content Signals per contentsignals.org:
#   search   - index the content and show links/snippets in results
#   ai-input - use the content inside AI answers (RAG, grounding)
#   ai-train - use the content to train or fine-tune models
# Surfacing uses (search, ai-input) are granted; ai-train is withheld
# pending a per-bucket policy decision (PR #3299 review).
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=no
Allow: /
Allow: /api/search
Disallow: /api/

# Withheld bucket: AI-training-only crawlers. These agents harvest
# content to train models — they neither index us for search nor
# answer user questions with it. Pending the owner's decision each
# stays disallowed; flipping one is a one-line change.
# Their answer-side siblings (ChatGPT-User, OAI-SearchBot,
# Claude-User, Claude-SearchBot, PerplexityBot, Perplexity-User,
# Amazonbot, Applebot, FacebookBot) remain welcome above.
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: CCBot
User-agent: meta-externalagent
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: Diffbot
User-agent: TikTokSpider
Disallow: /

# Pure-harvest SEO/scraper bucket (Bytespider, MJ12bot, AhrefsBot,
# SemrushBot, DotBot, PetalBot, BLEXBot, MegaIndex, Sogou,
# DataForSeoBot): hard-blocked at the edge/proxy — they ignore robots.

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;

export function GET(): NextResponse {
	return new NextResponse(BODY, {
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
}
