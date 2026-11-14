import type { Metadata } from "next";

/**
 * The shared missing-page contract: one branded title/metadata for every
 * human-facing 404. `not-found.tsx` and every route-level "entity missing"
 * metadata fallback must emit the identical contract so a missing resource
 * never advertises a different title or the homepage's OG block
 * (issue #2935 — uniform website 404s).
 */
export const NOT_FOUND_METADATA: Metadata = {
	title: "העמוד לא נמצא",
	openGraph: null,
};
