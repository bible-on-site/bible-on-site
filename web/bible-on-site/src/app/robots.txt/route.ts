/**
 * `/robots.txt` — crawl policy + AI Content Signals (issue #3257).
 * Serialized as a plain route handler because `MetadataRoute.Robots`
 * cannot emit the `Content-Signal` directive — the signal must live
 * inside a `User-agent: *` group to be valid (contentsignals.org).
 *
 * Policy: the whole public corpus is open (Allow: /); the narrow
 * `/api/` disallow protects management/dev/write endpoints while
 * `Allow: /api/search` keeps the public read API crawlable. Surfacing
 * uses (search, ai-input) are granted; ai-train is withheld pending a
 * per-bucket decision (PR #3299 review), and the pre-existing
 * pure-harvest bot bucket stays blocked in `src/proxy.ts`.
 */
import { NextResponse } from "next/server";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

export const dynamic = "force-static";

const BODY = `# תנ"ך על הפרק is a זיכוי הרבים project: the public learning
# corpus is open for indexing and AI input/retrieval.
# Content Signals per contentsignals.org:
#   search   - index the content and show links/snippets in results
#   ai-input - use the content inside AI answers (RAG, grounding)
#   ai-train - use the content to train or fine-tune models
# ai-train is withheld pending a per-bucket policy decision
# (PR #3299 review): surfacing uses are welcome, training is not
# granted by default.
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=no
Allow: /
Allow: /api/search
Disallow: /api/

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
