import Link from "next/link";
import { BreadcrumbDropdown } from "@/app/929/[number]/components/BreadcrumbDropdown";
import styles from "@/app/929/[number]/components/breadcrumb.module.css";
import { sefarim } from "@/data/db/sefarim";
import {
	getMasoraFirstUnitBySefer,
	getMasoraUnitsForSefer,
	MASORA_DIVISION,
} from "@/data/masora/masora-units";
import { getSeferByName } from "@/data/sefer-dto";
import type { ReadingUnit } from "@/lib/reading/contract";

const HELEK_ORDER = ["תורה", "נביאים", "כתובים"];

/**
 * Breadcrumb for a מסורה unit: תנ"ך > מסורה על הפרק > חלק > ספר > פרשה.
 * The last dropdown lists the sefer's units by their parasha-identity
 * headings — the unit-level picker for this division.
 */
export function UnitBreadcrumb({ unit }: { unit: ReadingUnit }) {
	const sefer = getSeferByName(unit.seferName);
	const firstUnits = getMasoraFirstUnitBySefer();
	const firstUnitBySefer = new Map(
		firstUnits.map((first) => [first.seferName, first]),
	);
	const sefarimInHelek = sefarim.filter((s) => s.helek === sefer.helek);
	const seferUnits = getMasoraUnitsForSefer(unit.seferName);
	const seferGridClass =
		sefer.helek === "תורה"
			? styles["sefer-grid-torah"]
			: sefer.helek === "נביאים"
				? styles["sefer-grid-neviim"]
				: styles["sefer-grid"];

	return (
		<nav
			data-testid={`masora-unit-breadcrumb-${unit.unitId}`}
			className={styles.grid}
			aria-label="Breadcrumb"
		>
			<div className={styles.container}>
				<ol className={styles.breadcrumb}>
					<li>
						<Link href="/">תנ&quot;ך על הפרק</Link>
					</li>
					<li>
						<Link href={MASORA_DIVISION.rootPath}>
							{MASORA_DIVISION.menuLabel}
						</Link>
					</li>
					<BreadcrumbDropdown
						label={sefer.helek}
						ariaLabel={`חלק נוכחי: ${sefer.helek}. לחץ לבחירת חלק אחר`}
					>
						<ul className={`${styles.list} ${styles.pl0}`}>
							{HELEK_ORDER.map((helek) => {
								const firstSefer = sefarim.find((s) => s.helek === helek);
								const target = firstSefer
									? firstUnitBySefer.get(firstSefer.name)
									: /* istanbul ignore next -- defensive: every helek has sefarim */
										undefined;
								return (
									<li key={helek}>
										{target ? (
											<Link
												href={`${MASORA_DIVISION.rootPath}/${target.unitId}`}
											>
												{helek}
											</Link>
										) : (
											helek
										)}
									</li>
								);
							})}
						</ul>
					</BreadcrumbDropdown>
					<BreadcrumbDropdown
						label={unit.seferName}
						ariaLabel={`ספר נוכחי: ${unit.seferName}. לחץ לבחירת ספר אחר`}
						dropClassName={seferGridClass}
					>
						<ul className={`${styles.list} ${styles.pl0}`}>
							{sefarimInHelek.map((s) => {
								const target = firstUnitBySefer.get(s.name);
								return (
									<li key={s.name}>
										{target ? (
											<Link
												href={`${MASORA_DIVISION.rootPath}/${target.unitId}`}
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
						label={unit.heading}
						ariaLabel={`פרשה נוכחית: ${unit.heading}. לחץ לבחירת פרשה אחרת`}
						isCurrentPage
						dropClassName={styles["perek-grid"]}
					>
						<ul className={`${styles.list} ${styles.pl0}`}>
							{seferUnits.map((seferUnit) => (
								<li key={seferUnit.unitId}>
									<Link
										href={`${MASORA_DIVISION.rootPath}/${seferUnit.unitId}`}
									>
										{seferUnit.heading}
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
