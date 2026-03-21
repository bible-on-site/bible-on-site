import type { CSSProperties } from "react";
import Link from "next/link";
import { CATEGORY_LABELS, ENTITY_TYPE_LABELS } from "@/lib/tanahpedia/service";
import {
	CATEGORY_HIERARCHY,
	labelForCategoryKey,
	subcategoryHref,
} from "@/lib/tanahpedia/category-hierarchy";
import type { EntityType, CategoryKey } from "@/lib/tanahpedia/types";
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
		? CATEGORY_LABELS[currentCategory] ??
			ENTITY_TYPE_LABELS[currentCategory as EntityType]
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
						<Link href="/tanahpedia">תנכפדיה</Link>
					</li>
					{currentCategory && (
						<li
							className={`${styles.active} ${styles.relative} ${styles["drop-container"]}`}
						>
							<button
								type="button"
								aria-haspopup="true"
								aria-expanded="false"
								aria-label={`קטגוריה נוכחית: ${currentLabel}. לחץ לבחירת קטגוריה אחרת`}
							>
								{currentLabel}
								<span
									className={`${styles.glyphicon} ${styles["glyphicon-triangle-bottom"]} ${styles.small}`}
									aria-hidden="true"
								/>
							</button>
							<div
								className={`${styles.drop} ${styles["bg-white"]} ${styles["tanahpedia-category-drop"]}`}
							>
								<ul className={`${styles.list} ${styles.pl0}`}>
									{CATEGORY_HIERARCHY.map(({ type, children }) => (
										<li
											key={type}
											className={styles["tanahpedia-category-group"]}
										>
											<Link
												href={`/tanahpedia/${type.toLowerCase()}`}
												className={styles["tanahpedia-category-parent"]}
											>
												{ENTITY_TYPE_LABELS[type]}
											</Link>
											{children && children.length > 0 && (
												<ul className={styles["tanahpedia-nested"]}>
													{children.map((sub) => (
														<li key={sub}>
															<Link href={subcategoryHref(sub)}>
																{labelForCategoryKey(sub)}
															</Link>
														</li>
													))}
												</ul>
											)}
										</li>
									))}
								</ul>
							</div>
						</li>
					)}
					{currentEntryTitle &&
						(siblingEntries.length > 0 ? (
							<li
								className={`${styles.active} ${styles.relative} ${styles["drop-container"]}`}
								aria-current="page"
							>
								<button
									type="button"
									aria-haspopup="true"
									aria-expanded="false"
									aria-label={`ערך נוכחי: ${currentEntryTitle}. לחץ לבחירת ערך אחר באותה קטגוריה`}
								>
									{currentEntryTitle}
									<span
										className={`${styles.glyphicon} ${styles["glyphicon-triangle-bottom"]} ${styles.small}`}
										aria-hidden="true"
									/>
								</button>
								<div
									className={`${styles.drop} ${styles["bg-white"]} ${styles["perek-grid"]}`}
									style={
										{ "--perek-rows": entryRows } as CSSProperties
									}
								>
									<ul className={`${styles.list} ${styles.pl0}`}>
										{siblingEntries.map((e) => (
											<li key={e.uniqueName}>
												<Link
													href={`/tanahpedia/entry/${encodeURIComponent(e.uniqueName)}`}
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
								</div>
							</li>
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
