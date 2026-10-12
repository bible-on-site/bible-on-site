import Image from "next/image";
import Link from "next/link";

/**
 * Site header bar shown on every page: the logo links home from the center
 * and an icon-only search button is pinned to the physical left edge,
 * opposite the hamburger trigger at the right edge.
 * Server-rendered so the entry points stay crawlable and need no hydration.
 */
export function TopNav() {
	return (
		<nav className="top-nav" aria-label="ניווט עליון">
			<Link href="/">
				<Image
					src="/images/logos/logo-white-letters-69.webp"
					alt='תנ"ך על הפרק'
					loading="eager"
					width={69}
					height={50}
					style={{ width: 72, height: "auto" }}
				/>
			</Link>
			<Link href="/search" className="top-nav-search" aria-label="חיפוש">
				<Image src="/icons/search.svg" alt="" width={24} height={24} />
			</Link>
		</nav>
	);
}
