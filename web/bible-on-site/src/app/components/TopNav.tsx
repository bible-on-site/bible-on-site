import Image from "next/image";
import Link from "next/link";

/**
 * Site header bar shown on every page: the logo links home and a dedicated
 * search button sits beside it, well separated from the hamburger trigger.
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
			<Link href="/search" className="top-nav-search">
				<Image src="/icons/search.svg" alt="" width={20} height={20} />
				<span>חיפוש</span>
			</Link>
		</nav>
	);
}
