import Link from "next/link";
import { BreadcrumbDropdown } from "@/app/929/[number]/components/BreadcrumbDropdown";
import styles from "@/app/929/[number]/components/breadcrumb.module.css";
import { sefarim } from "@/data/db/sefarim";
import {
	getParashaFirstUnitBySefer,
	getParashaUnitsForSefer,
	PARASHA_DIVISION,
} from "@/data/parasha/parasha-units";
import type { ReadingUnit } from "@/lib/reading/contract";

/**
 * Breadcrumb for a פרשה unit: תנ"ך > פרשה על הפרק > תורה > ספר > פרשה.
 * The division covers only the five Torah sefarim, so the חלק and ספר
 * pickers stay inside תורה; the last dropdown lists the sefer's
 * parashot by name — the parasha picker for this division.
 */
export function UnitBreadcrumb({ unit }: { unit: ReadingUnit }) {
	const firstUnits = getParashaFirstUnitBySefer();
	const firstUnitBySefer = new Map(
		firstUnits.map((first) => [first.seferName, first]),
	);
	const torahSefarim = sefarim.filter((s) => s.helek === "תורה");
	const seferUnits = getParashaUnitsForSefer(unit.seferName);

	return (
		<nav
			data-testid={`parasha-unit-breadcrumb-${unit.unitId}`}
			className={styles.grid}
			aria-label="Breadcrumb"
		>
			<div className={styles.container}>
				<ol className={styles.breadcrumb}>
					<li>
						<Link href="/">תנ&quot;ך על הפרק</Link>
					</li>
					<li>
						<Link href={PARASHA_DIVISION.rootPath}>
							{PARASHA_DIVISION.menuLabel}
						</Link>
					</li>
					<BreadcrumbDropdown
						label="תורה"
						ariaLabel="חלק נוכחי: תורה. לחץ לבחירת ספר"
						dropClassName={styles["sefer-grid-torah"]}
					>
						<ul className={`${styles.list} ${styles.pl0}`}>
							{torahSefarim.map((s) => {
								const target = firstUnitBySefer.get(s.name);
								return (
									<li key={s.name}>
										{target ? (
											<Link
												href={`${PARASHA_DIVISION.rootPath}/${target.slug}`}
											>
												{s.name}
											</Link>
										) : (
											s.name
										)}
									</li>
								);
							})}
						</ul>
					</BreadcrumbDropdown>
					<BreadcrumbDropdown
						label={unit.seferName}
						ariaLabel={`ספר נוכחי: ${unit.seferName}. לחץ לבחירת ספר אחר`}
						dropClassName={styles["sefer-grid-torah"]}
					>
						<ul className={`${styles.list} ${styles.pl0}`}>
							{torahSefarim.map((s) => {
								const target = firstUnitBySefer.get(s.name);
								return (
									<li key={s.name}>
										{target ? (
											<Link
												href={`${PARASHA_DIVISION.rootPath}/${target.slug}`}
											>
												{s.name}
											</Link>
										) : (
											s.name
										)}
									</li>
								);
							})}
						</ul>
					</BreadcrumbDropdown>
					<BreadcrumbDropdown
						label={`פרשת ${unit.heading}`}
						ariaLabel={`פרשה נוכחית: ${unit.heading}. לחץ לבחירת פרשה אחרת`}
						isCurrentPage
						dropClassName={styles["perek-grid"]}
					>
						<ul className={`${styles.list} ${styles.pl0}`}>
							{seferUnits.map((seferUnit) => (
								<li key={seferUnit.unitId}>
									<Link
										href={`${PARASHA_DIVISION.rootPath}/${seferUnit.slug}`}
									>
										פרשת {seferUnit.heading}
									</Link>
								</li>
							))}
						</ul>
					</BreadcrumbDropdown>
				</ol>
			</div>
		</nav>
	);
}
