/**
 * Markdown representation of the public corpus (issue #3257).
 *
 * Reachable two ways, both pinned to the canonical path's identity:
 * - explicit `<canonical>.md` URLs, rewritten here by the proxy;
 * - `Accept: text/markdown` negotiation on the canonical path itself
 *   (the proxy rewrites, so `Content-Location` stays the canonical URL
 *   and `Vary: Accept` is the response's own contract).
 *
 * The path is allowlist-resolved (`markdownTargetForPath`) — only known
 * public route families produce documents; anything else is a 404.
 * Renderers return `null` for genuinely missing/unpublished content
 * (404) and throw on transient backend failure (503, never cached).
 */
import { NextResponse } from "next/server";
import { markdownTargetForPath } from "@/lib/markdown/paths";
import { renderMarkdown } from "@/lib/markdown/render";

export const dynamic = "force-dynamic";

const MARKDOWN_TYPE = "text/markdown; charset=utf-8";

/**
 * Canonical paths arrive in mixed spellings — renderers emit raw Hebrew
 * for some routes and percent-encoded for others (entry/perush hrefs,
 * pedia categories). Decode-then-encode each segment once so encoded
 * triplets stay stable and raw Hebrew encodes exactly once (header
 * values are ByteString — the same spelling the sitemap emits).
 */
function encodePathForHeader(path: string): string {
	return path
		.split("/")
		.map((segment) => {
			try {
				return encodeURIComponent(decodeURIComponent(segment));
			} catch {
				// Malformed escapes — encode the literal segment.
				return encodeURIComponent(segment);
			}
		})
		.join("/");
}

function discoveryLinks(canonicalPath: string): string {
	const encoded = encodePathForHeader(canonicalPath);
	const mdPath = canonicalPath === "/" ? "/.md" : `${encoded}.md`;
	return [
		`<${encoded}>; rel="alternate"; type="text/html"`,
		`<${mdPath}>; rel="alternate"; type="text/markdown"`,
		`</llms.txt>; rel="help"; type="text/markdown"`,
	].join(", ");
}

function markdownResponse(body: string, canonicalPath: string): NextResponse {
	return new NextResponse(body, {
		status: 200,
		headers: {
			"content-type": MARKDOWN_TYPE,
			// Short shared-cache lifetime; content expiry stays event-driven
			// (the service loaders' unstable_cache tags) so the CDN copy can
			// trail an edit by minutes at most, never by a stale false-404.
			"cache-control":
				"public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
			vary: "Accept",
			link: discoveryLinks(canonicalPath),
		},
	});
}

function notFoundResponse(): NextResponse {
	return new NextResponse("Not found", {
		status: 404,
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}

async function respond(
	path: string[] | undefined,
	method: "GET" | "HEAD",
): Promise<NextResponse> {
	const pathname = `/${(path ?? []).join("/")}`;
	const target = markdownTargetForPath(pathname);
	if (!target) return notFoundResponse();
	try {
		const document = await renderMarkdown(target);
		if (!document) return notFoundResponse();
		return markdownResponse(
			method === "HEAD" ? "" : document.markdown,
			document.canonicalPath,
		);
	} catch (error) {
		console.error(
			`[md] transient failure rendering ${pathname}:`,
			error instanceof Error ? error.message : error,
		);
		return new NextResponse("Service unavailable", {
			status: 503,
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"cache-control": "no-store",
				"retry-after": "60",
			},
		});
	}
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ path?: string[] }> },
): Promise<NextResponse> {
	return respond((await params).path, "GET");
}

export async function HEAD(
	_request: Request,
	{ params }: { params: Promise<{ path?: string[] }> },
): Promise<NextResponse> {
	return respond((await params).path, "HEAD");
}
