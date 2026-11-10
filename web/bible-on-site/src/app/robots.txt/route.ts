/**
 * `/robots.txt` — crawl policy + affirmative AI Content Signals
 * (issue #3257). Serialized as a plain route handler because
 * `MetadataRoute.Robots` cannot emit the `Content-Signal` directive —
 * the signal must live inside a `User-agent: *` group to be valid
 * (contentsignals.org).
 *
 * Policy: the whole public corpus is open (Allow: /); the narrow
 * `/api/` disallow protects management/dev/write endpoints while
 * `Allow: /api/search` keeps the public read API crawlable.
 */
import { NextResponse } from "next/server";
import { SITE_ORIGIN } from "@/lib/seo/jsonld";

export const dynamic = "force-static";

const BODY = `# תנ"ך על הפרק is a זיכוי הרבים project: the public learning
# corpus is open for indexing, AI input/retrieval and training.
# Content Signals per contentsignals.org:
#   search   - index the content and show links/snippets in results
#   ai-input - use the content inside AI answers (RAG, grounding)
#   ai-train - use the content to train or fine-tune models
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=yes
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
