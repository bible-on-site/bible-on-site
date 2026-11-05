import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import type { CSSProperties } from "react";
import {
	getPublishedMoadim,
	MOADIM_ROOT,
	MOED_STALE_BOUND_SECONDS,
	moedHref,
} from "@/lib/moadim";
import { COLLECTION_TAGS } from "@/lib/revalidate/tags";
import { SITE_NAME } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/opengraph";
import styles from "./page.module.css";

// Hourly bound keeps a pre-migration empty catalogue from pinning — the
// data-deploy seed lands without a website invalidation, so the catalogue
// self-heals on the next ISR window (editorial writes still expire via tag).
const getCachedMoadim = unstable_cache(getPublishedMoadim, ["moadim-catalogue"], {
	tags: [COLLECTION_TAGS.moadim],
	revalidate: MOED_STALE_BOUND_SECONDS,
});

export async function generateMetadata(): Promise<Metadata> {
	return pageMetadata({
		title: `מועדים על הפרק | ${SITE_NAME}`,
		description:
			'קריאות התנ"ך למועדי ישראל ולימים המיוחדים — מעגל השנה של מועדים עם פסוקים, פירושים ומאמרים לכל מועד.',
		canonical: MOADIM_ROOT,
	});
}

/**
 * מועדים על הפרק landing — the annual wheel (מעגל השנה). Every published
 * moed sits on the circle at its stored `annual_order` slot; the order is
 * a display contract, never calendar arithmetic. Labels stay upright
 * (rotate–translate–unrotate), real anchors keep keyboard order equal to
 * annual order, and the decorative rings carry no semantics or tab stops.
 * An ordered index below the wheel repeats the same links so the
 * catalogue stays discoverable at any zoom or viewport.
 */
export default async function MoadimLanding() {
	const moadim = await getCachedMoadim();
	const count = Math.max(moadim.length, 1);
	// Wheel slots span the full circle evenly in annual order — the stored
	// ordinal decides the position (top = first), not a Hebrew-date rule.
	const angleFor = (index: number) => (index / count) * 360;

	return (
		<div className={styles.container}>
			<h1 className={styles.heading}>מועדים על הפרק</h1>
			<p className={styles.intro}>
				מעגל השנה של קריאות התנ&quot;ך למועדי ישראל ולימים המיוחדים — כל מועד
				עם הפסוקים, הפירושים והמאמרים שלו.
			</p>
			{moadim.length === 0 ? (
				<p className={styles.empty}>אין מועדים מפורסמים עדיין.</p>
			) : (
				<>
					<div className={styles.wheel} role="presentation">
						<div className={styles.wheelRing} aria-hidden="true" />
						<div className={styles.wheelRingInner} aria-hidden="true" />
						<ul className={styles.wheelList}>
							{moadim.map((moed, index) => (
								<li
									key={moed.id}
									className={styles.wheelItem}
									style={
										{
											"--angle": `${angleFor(index)}deg`,
										} as CSSProperties
									}
								>
									<Link
										href={moedHref(moed.slug)}
										className={styles.wheelLink}
									>
										<span className={styles.wheelName}>{moed.name}</span>
										{moed.dateLabel && (
											<span className={styles.wheelDate}>{moed.dateLabel}</span>
										)}
									</Link>
								</li>
							))}
						</ul>
					</div>
					<nav aria-label="רשימת המועדים" className={styles.index}>
						<ol className={styles.indexList}>
							{moadim.map((moed) => (
								<li key={moed.id} className={styles.indexItem}>
									<Link href={moedHref(moed.slug)} className={styles.indexLink}>
										<span className={styles.indexName}>{moed.name}</span>
										{moed.dateLabel && (
											<span className={styles.indexDate}>{moed.dateLabel}</span>
										)}
										{moed.hebrewMonth && (
											<span className={styles.indexMonth}>
												{moed.hebrewMonth}
											</span>
										)}
									</Link>
								</li>
							))}
						</ol>
					</nav>
				</>
			)}
		</div>
	);
}
