/**
 * `/robots.txt` — crawl policy + AI Content Signals (issue #3257).
 * Serialized as a plain route handler because `MetadataRoute.Robots`
 * cannot emit the `Content-Signal` directive — the signal must live
 * inside a `User-agent: *` group to be valid (contentsignals.org).
 *
 * The owner welcomes search, AI answers, and model training on the
 * public learning corpus as part of זיכוי הרבים. All welcomed agents
 * share the wildcard group's public/private boundaries. Unrelated
 * SEO scrapers remain blocked in `src/proxy.ts`.
 */
import { NextResponse } from "next/server";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

export const dynamic = "force-static";

const BODY = `# תנ"ך על הפרק is a זיכוי הרבים project: the public learning
# corpus is open for search, AI answers, and model training.
# Learning from our content in model weights is welcome in itself.
# Content Signals per contentsignals.org:
#   search   - index the content and show links/snippets in results
#   ai-input - use the content inside AI answers (RAG, grounding)
#   ai-train - use the content to train or fine-tune models
# Search, AI input, training and fine-tuning are all welcome.
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=yes
Allow: /
Allow: /api/search
Disallow: /api/
Disallow: /dev

# SEO/scraper bucket (MJ12bot, AhrefsBot,
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
