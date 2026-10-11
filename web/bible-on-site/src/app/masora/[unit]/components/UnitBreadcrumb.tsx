import Link from "next/link";
import { sefarim } from "@/data/db/sefarim";
import {
	getMasoraFirstUnitBySefer,
	getMasoraUnitsForSefer,
	MASORA_DIVISION,
} from "@/data/masora/masora-units";
import { getSeferByName } from "@/data/sefer-dto";
import type { ReadingUnit } from "@/lib/reading/contract";
import { BreadcrumbDropdown } from "@/app/929/[number]/components/BreadcrumbDropdown";
import styles from "@/app/929/[number]/components/breadcrumb.module.css";

const HELEK_ORDER = ["תורה", "נביאים", "כתובים"];

/**
 * Breadcrumb for a מסורה unit: תנ"ך > מסורה על הפרק > חלק > ספר > יחידה.
 * The last dropdown lists the sefer's units by their scripture-span
 * headings — the unit-level "chapter picker" for this division.
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
									: undefined;
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
						ariaLabel={`יחידה נוכחית: ${unit.heading}. לחץ לבחירת יחידה אחרת`}
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
