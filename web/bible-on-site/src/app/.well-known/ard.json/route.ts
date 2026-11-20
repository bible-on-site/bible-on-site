/**
 * `/.well-known/ard.json` - ARD v0.91 capability manifest (issue #3257).
 * The current canonical well-known path; `/.well-known/ai-catalog.json`
 * serves the same document for clients on the earlier draft.
 */
import { NextResponse } from "next/server";
import { aiCatalogManifest } from "@/lib/ai-catalog";

export const dynamic = "force-static";

export function GET(): NextResponse {
	return NextResponse.json(aiCatalogManifest(), {
		headers: {
			"content-type": "application/ard+json; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
}
