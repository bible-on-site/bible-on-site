/**
 * `/auth.md` — the honest answer to "how do agents authenticate here"
 * (issue #3257): they don't. Every public read endpoint is anonymous —
 * no registration, keys, OAuth or bot identity to obtain. The document
 * states that plainly so agents stop hunting for a ceremony that does
 * not exist, and points at the real catalog.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-static";

const BODY = `# auth.md

## No authentication is required

The public learning corpus of תנ"ך על הפרק is anonymous and open:
there is **no registration flow, no API key, no OAuth server, no
agent-identity ceremony** for reading. Fetch any public page or call
\`GET /api/search\` directly — a plain HTTP client is all you need.

## What this means in practice

- Do not look for \`/.well-known/oauth-authorization-server\`,
  \`/.well-known/oauth-protected-resource\` or a token endpoint — the
  public surface has none because nothing needs a token.
- Public GET/HEAD requests are never answered with 401 or
  \`WWW-Authenticate\`. A 403 is returned only to a small bucket of
  SEO/scraper user-agents listed in \`/robots.txt\`; browsers, search,
  AI-input and AI-training crawlers all read the same corpus.
- The few private surfaces (admin, \`/dev\`, write and subscription
  endpoints) are not part of the agent corpus and are deliberately
  undocumented here — there is nothing for an agent to do with them.

## Where the real capabilities live

- \`/.well-known/api-catalog\` — RFC 9727 linkset of the public endpoints.
- \`/openapi.json\` — the anonymous /api/search contract.
- \`/llms.txt\` — the agent guide to the corpus and its usage policy.
- \`/.well-known/agent-skills/index.json\` — skills for traversing,
  searching and citing the corpus.
`;

export function GET(): NextResponse {
	return new NextResponse(BODY, {
		headers: {
			"content-type": "text/markdown; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
}
