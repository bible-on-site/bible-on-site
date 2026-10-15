"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** The על הפרק reader section: chapter reading (incl. Sefer/book mode),
 * authors and every nested route under /929. */
const READER_PATH = "/929";

/** על הפרק paths: the section root plus everything nested below it. */
export function isReaderPathname(pathname: string): boolean {
	return pathname === READER_PATH || pathname.startsWith(`${READER_PATH}/`);
}

/**
 * Icon-only search button pinned to the physical left edge of the top nav.
 * Omitted entirely on the על הפרק reader — its settings button occupies
 * that corner, so no clickable or focusable remnant may stay (#2274).
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
