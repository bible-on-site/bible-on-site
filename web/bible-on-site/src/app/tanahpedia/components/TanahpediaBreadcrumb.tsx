import Link from "next/link";
import { ENTITY_TYPE_LABELS, ENTITY_TYPES, CATEGORY_LABELS } from "@/lib/tanahpedia/service";
import type { EntityType, CategoryKey } from "@/lib/tanahpedia/types";
import styles from "../../929/[number]/components/breadcrumb.module.css";

interface TanahpediaBreadcrumbProps {
	currentCategory?: CategoryKey | null;
	currentEntryTitle?: string | null;
}

export function TanahpediaBreadcrumb({
	currentCategory,
	currentEntryTitle,
}: TanahpediaBreadcrumbProps) {
	// Get all entity types for the category dropdown
	const allCategories = ENTITY_TYPES.map((type) => ({
		key: type as CategoryKey,
		label: ENTITY_TYPE_LABELS[type],
		url: `/tanahpedia/${type.toLowerCase()}`,
	}));

	// Get current category label
	const currentLabel = currentCategory
		? CATEGORY_LABELS[currentCategory] ?? ENTITY_TYPE_LABELS[currentCategory as EntityType]
		: null;

	return (
		<nav
			data-testid="tanahpedia-breadcrumb"
			className={styles.grid}
			aria-label="Breadcrumb"
		>
			<div className={styles.container}>
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
								aria-label={`קטגוריה נוכחית: ${currentLabel}. לחץ לבחירת קטגוריה אחרת`}
							>
								{currentLabel}
								<span
									className={`${styles.glyphicon} ${styles["glyphicon-triangle-bottom"]} ${styles.small}`}
									aria-hidden="true"
								/>
							</button>
							<div className={`${styles.drop} ${styles["bg-white"]}`}>
								<ul className={`${styles.list} ${styles.pl0}`}>
									{allCategories.map((cat) => (
										<li key={cat.key}>
											<Link href={cat.url}>{cat.label}</Link>
										</li>
									))}
									{/* Add PERSON subcategories */}
									<li>
										<Link href="/tanahpedia/person?role=prophet">
											{CATEGORY_LABELS.PROPHET}
										</Link>
									</li>
									<li>
										<Link href="/tanahpedia/person?role=king">
											{CATEGORY_LABELS.KING}
										</Link>
									</li>
								</ul>
							</div>
						</li>
					)}
					{currentEntryTitle && (
						<li
							className={`${styles.active} ${styles.relative}`}
							aria-current="page"
						>
							{currentEntryTitle}
						</li>
					)}
				</ol>
			</div>
		</nav>
	);
}

export default TanahpediaBreadcrumb;
