/**
 * `/.well-known/ai-catalog.json` - AI Catalog manifest (issue #3257).
 * Predecessor path of `/.well-known/ard.json` (ARD v0.91); the Cloudflare
 * readiness scanner and clients written against the earlier draft still
 * probe here, so both paths serve the same real-artifact manifest.
 */
import { NextResponse } from "next/server";
import { aiCatalogManifest } from "@/lib/ai-catalog";

export const dynamic = "force-static";

export function GET(): NextResponse {
	return NextResponse.json(aiCatalogManifest(), {
		headers: {
			"content-type": "application/ai-catalog+json; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
}
