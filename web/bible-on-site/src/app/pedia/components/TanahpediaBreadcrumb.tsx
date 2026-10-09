import Link from "next/link";
import type { CSSProperties } from "react";
import {
	CATEGORY_HIERARCHY,
	labelForCategoryKey,
} from "@/lib/tanahpedia/category-hierarchy";
import { categoryHref } from "@/lib/tanahpedia/category-slug";
import { CATEGORY_LABELS, ENTITY_TYPE_LABELS } from "@/lib/tanahpedia/service";
import type { CategoryKey, EntityType } from "@/lib/tanahpedia/types";
import { BreadcrumbDropdown } from "../../929/[number]/components/BreadcrumbDropdown";
import styles from "../../929/[number]/components/breadcrumb.module.css";

export interface TanahpediaEntryNavItem {
	uniqueName: string;
	title: string;
}

interface TanahpediaBreadcrumbProps {
	currentCategory?: CategoryKey | null;
	currentEntryTitle?: string | null;
	/** For entry dropdown links */
	currentEntryUniqueName?: string | null;
	siblingEntries?: TanahpediaEntryNavItem[];
}

export function TanahpediaBreadcrumb({
	currentCategory,
	currentEntryTitle,
	currentEntryUniqueName,
	siblingEntries = [],
}: TanahpediaBreadcrumbProps) {
	const currentLabel = currentCategory
		? (CATEGORY_LABELS[currentCategory] ??
			ENTITY_TYPE_LABELS[currentCategory as EntityType])
		: null;

	const entryRows = Math.min(Math.max(siblingEntries.length, 1), 10);

	return (
		<nav
			data-testid="tanahpedia-breadcrumb"
			className={`${styles.grid} ${styles["tanahpedia-nav"]}`}
			aria-label="Breadcrumb"
		>
			<div className={`${styles.container} ${styles["tanahpedia-inner"]}`}>
				<ol className={styles.breadcrumb}>
					<li>
						<Link href="/">תנ&quot;ך על הפרק</Link>
					</li>
					<li>
						<Link href="/pedia">תנכפדיה</Link>
					</li>
					{currentCategory && (
						<BreadcrumbDropdown
							label={currentLabel}
							ariaLabel={`קטגוריה נוכחית: ${currentLabel}. לחץ לבחירת קטגוריה אחרת`}
							dropClassName={styles["tanahpedia-category-drop"]}
						>
							<ul className={`${styles.list} ${styles.pl0}`}>
								{CATEGORY_HIERARCHY.map(({ type, children }) => (
									<li
										key={type}
										className={styles["tanahpedia-category-group"]}
									>
										<Link
											href={categoryHref(type)}
											className={styles["tanahpedia-category-parent"]}
										>
											{ENTITY_TYPE_LABELS[type]}
										</Link>
										{children && children.length > 0 && (
											<ul className={styles["tanahpedia-nested"]}>
												{children.map((sub) => (
													<li key={sub}>
														<Link href={categoryHref(sub)}>
															{labelForCategoryKey(sub)}
														</Link>
													</li>
												))}
											</ul>
										)}
									</li>
								))}
							</ul>
						</BreadcrumbDropdown>
					)}
					{currentEntryTitle &&
						(siblingEntries.length > 0 ? (
							<BreadcrumbDropdown
								label={currentEntryTitle}
								ariaLabel={`ערך נוכחי: ${currentEntryTitle}. לחץ לבחירת ערך אחר באותה קטגוריה`}
								isCurrentPage
								dropClassName={styles["perek-grid"]}
								dropStyle={{ "--perek-rows": entryRows } as CSSProperties}
							>
								<ul className={`${styles.list} ${styles.pl0}`}>
									{siblingEntries.map((e) => (
										<li key={e.uniqueName}>
											<Link
												href={`/pedia/${encodeURIComponent(e.uniqueName)}`}
												aria-current={
													e.uniqueName === currentEntryUniqueName
														? "page"
														: undefined
												}
											>
												{e.title}
											</Link>
										</li>
									))}
								</ul>
							</BreadcrumbDropdown>
						) : (
							<li
								className={`${styles.active} ${styles.relative}`}
								aria-current="page"
							>
								{currentEntryTitle}
							</li>
						))}
				</ol>
			</div>
		</nav>
	);
}

export default TanahpediaBreadcrumb;
