"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** על הפרק reader section — the whole /929 tree (#2274). */
const PEREK_READER_ROOT = "/929";

/** Masora/Parasha unit readers mount the same settings button in this
 *  corner, so the collision exists below their unit routes too. Both the
 *  public Hebrew path and the internal ASCII route dir must match — the
 *  browser URL is the former while prerendering sees the latter. */
const UNIT_READER_ROOTS = ["/מסורה", "/masora", "/פרשה", "/parasha"];

/** Reader sections whose settings button occupies the top-left corner. */
export function isReaderPathname(pathname: string): boolean {
	// The router may hand over a percent-encoded Hebrew path (same decoding
	// as masora-book-utils.ts).
	const decoded = decodeURIComponent(pathname);
	return (
		decoded === PEREK_READER_ROOT ||
		decoded.startsWith(`${PEREK_READER_ROOT}/`) ||
		UNIT_READER_ROOTS.some((root) => decoded.startsWith(`${root}/`))
	);
}

/**
 * Routes whose layout actually mounts the reader preferences gear in the
 * top-left corner — a narrower set than isReaderPathname: the search button
 * is suppressed across the whole reader section, but the gear itself only
 * exists on unit pages (929/[number], masora/[unit], parasha/[unit]
 * layouts). Non-unit reader routes such as /929/authors hide the search
 * button yet mount no gear, so the accessibility trigger must not dock at
 * the gear-adjacent offset there (#2396).
 */
export function hasReaderSettingsGear(pathname: string): boolean {
	const decoded = decodeURIComponent(pathname);
	const authorsRoot = `${PEREK_READER_ROOT}/authors`;
	const isAuthorsRoute =
		decoded === authorsRoot || decoded.startsWith(`${authorsRoot}/`);
	return (
		(decoded.startsWith(`${PEREK_READER_ROOT}/`) && !isAuthorsRoute) ||
		UNIT_READER_ROOTS.some((root) => decoded.startsWith(`${root}/`))
	);
}

/**
 * Icon-only search button pinned to the physical left edge of the top nav.
 * Omitted entirely on reader pages — their settings button occupies that
 * corner, so no clickable or focusable remnant may stay (#2274).
 * Route-aware, so it needs hydration; the rest of the bar stays server-only.
 */
export function TopNavSearch() {
	const pathname = usePathname();
	if (isReaderPathname(pathname)) return null;

	return (
		<Link href="/search" className="top-nav-search" aria-label="חיפוש">
			<Image src="/icons/search.svg" alt="" width={24} height={24} />
		</Link>
	);
}
