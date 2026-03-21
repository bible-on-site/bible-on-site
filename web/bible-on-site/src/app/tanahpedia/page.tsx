import type { Metadata } from "next";
import Link from "next/link";
import {
	CATEGORY_LABELS,
	getCategoryCounts,
	getRecentEntries,
	getTodayInTanahEvents,
} from "@/lib/tanahpedia/service";
import type { CategoryKey } from "@/lib/tanahpedia/types";
import {
	CATEGORY_HIERARCHY,
	subcategoryHref,
} from "@/lib/tanahpedia/category-hierarchy";
import { HebrewDate } from "@/util/hebdates-util";
import styles from "./page.module.css";

export const metadata: Metadata = {
	title: 'תנכפדיה | תנ"ך על הפרק',
	description: 'אנציקלופדיה לתנ"ך - אישים, מקומות, אירועים ועוד',
};

// SSG: This page is statically generated at build time
export const revalidate = 3600;

export default async function TanahpediaLandingPage() {
	const today = HebrewDate.fromGregorian(new Date());
	const hebrewMonth = today.getUniformMonth();
	const hebrewDay = today.day;
	const hebrewDateStr = today.toTraditionalHebrewString();

	let counts: Record<CategoryKey, number>;
	let recentEntries: Awaited<ReturnType<typeof getRecentEntries>>;
	let todayEvents: Awaited<ReturnType<typeof getTodayInTanahEvents>>;
	try {
		[counts, recentEntries, todayEvents] = await Promise.all([
			getCategoryCounts(),
			getRecentEntries(8),
			getTodayInTanahEvents(hebrewMonth, hebrewDay),
		]);
	} catch {
		counts = Object.fromEntries(
			Object.keys(CATEGORY_LABELS).map((k) => [k, 0]),
		) as Record<CategoryKey, number>;
		recentEntries = [];
		todayEvents = [];
	}

	return (
		<div className={styles.tanahpediaPage}>
			<h1 className={styles.pageTitle}>תנכפדיה</h1>
			<p className={styles.pageSubtitle}>
				אנציקלופדיה לתנ&quot;ך - אישים, מקומות, אירועים, חפצים ועוד
			</p>

			{todayEvents.length > 0 && (
				<section className={styles.todaySection}>
					<div className={styles.todayHeader}>
						<h2 className={styles.todaySectionTitle}>
							היום בתנ&quot;ך
						</h2>
						<span className={styles.todayDate}>{hebrewDateStr}</span>
					</div>
					<ul className={styles.todayList}>
						{todayEvents.map((event) => (
							<li key={event.entityId} className={styles.todayItem}>
								<span className={styles.todayBullet}>●</span>
								<span className={styles.todayText}>
									{event.entryUniqueName ? (
										<Link
											href={`/tanahpedia/entry/${encodeURIComponent(event.entryUniqueName)}`}
											className={styles.todayLink}
										>
											{event.entryTitle ?? event.entityName}
										</Link>
									) : (
										<strong>{event.entityName}</strong>
									)}
								</span>
							</li>
						))}
					</ul>
				</section>
			)}

			<section>
				<h2 className={styles.sectionTitle}>קטגוריות</h2>
				<div className={styles.categoryGrid}>
					{CATEGORY_HIERARCHY.map((cat) => (
						<div key={cat.type} className={styles.categoryGroup}>
							<Link
								href={`/tanahpedia/${cat.type.toLowerCase()}`}
								className={styles.categoryCard}
							>
								<div className={styles.categoryName}>
									{CATEGORY_LABELS[cat.type]}
								</div>
								<div className={styles.categoryCount}>
									{counts[cat.type]} ערכים
								</div>
							</Link>
							{cat.children && cat.children.length > 0 && (
								<div className={styles.subcategoryList}>
									{cat.children.map((sub) => (
										<Link
											key={sub}
											href={subcategoryHref(sub)}
											className={styles.subcategoryCard}
										>
											<span className={styles.subcategoryName}>
												{CATEGORY_LABELS[sub]}
											</span>
											<span className={styles.subcategoryCount}>
												{counts[sub]}
											</span>
										</Link>
									))}
								</div>
							)}
						</div>
					))}
				</div>
			</section>

			{recentEntries.length > 0 && (
				<section>
					<h2 className={styles.sectionTitle}>עודכנו לאחרונה</h2>
					<ul className={styles.recentList}>
						{recentEntries.map((entry) => (
							<li key={entry.id} className={styles.recentItem}>
								<Link
									href={`/tanahpedia/entry/${encodeURIComponent(entry.uniqueName)}`}
									className={styles.recentLink}
								>
									{entry.title}
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}

			<div className={styles.backLinkWrapper}>
				<Link href="/" className={styles.backLink}>
					חזרה לעמוד הראשי
				</Link>
			</div>
		</div>
	);
}
