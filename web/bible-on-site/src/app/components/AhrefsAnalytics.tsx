import Script from "next/script";
import { isProduction } from "@/util/environment";

const AHREFS_ANALYTICS_KEY = "G7ksy4fTmIqbChcszvHcDw";

/**
 * Ahrefs Web Analytics, direct async install (#2376). The script tracks
 * SPA/history navigations itself, so loading it once in the root layout
 * covers client-side chapter and Sefer navigation without manual events.
 * Production-only: development, preview and E2E traffic never reach the
 * production property. Edge bot blocking stays in nginx; no client-side
 * UA gate here so Ahrefs' installation checker detects the snippet.
 */
export function AhrefsAnalytics() {
	if (!isProduction()) {
		return null;
	}

	return (
		<Script
			src="https://analytics.ahrefs.com/analytics.js"
			data-key={AHREFS_ANALYTICS_KEY}
			strategy="afterInteractive"
		/>
	);
}
