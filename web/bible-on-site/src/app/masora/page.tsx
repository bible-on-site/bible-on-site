import type { Metadata } from "next";
import Link from "next/link";
import { sefarim } from "@/data/db/sefarim";
import {
	getMasoraFirstUnitBySefer,
	getMasoraUnitsForSefer,
	MASORA_DIVISION,
} from "@/data/masora/masora-units";
import { SITE_NAME } from "@/lib/seo/jsonld";
import styles from "./page.module.css";

const HELEK_ORDER = ["תורה", "נביאים", "כתובים"];

export async function generateMetadata(): Promise<Metadata> {
	const title = `${MASORA_DIVISION.menuLabel} | ${SITE_NAME}`;
	const description =
		'קריאת התנ"ך לפי חלוקת המסורה — פרשיות פתוחות וסתומות בכל התנ"ך, עם פירושים ומאמרים.';
	return {
		title,
		description,
		alternates: { canonical: MASORA_DIVISION.rootPath },
		openGraph: {
			title,
			description,
			url: MASORA_DIVISION.rootPath,
			siteName: SITE_NAME,
			locale: "he_IL",
		},
	};
}

/**
 * מסורה root landing — sefer browsing for the Masoretic (פתוחה/סתומה)
 * division. Each sefer links to its first unit and lists its unit count;
 * per-unit navigation continues through the unit breadcrumb dropdown and
 * prev/next links.
 */
export default function MasoraLanding() {
	const firstUnits = getMasoraFirstUnitBySefer();
	const firstUnitBySefer = new Map(
		firstUnits.map((unit) => [unit.seferName, unit]),
	);

	return (
		<div className={styles.container}>
			<h1 className={styles.heading}>{MASORA_DIVISION.menuLabel}</h1>
			<p className={styles.intro}>
				קריאת התנ&quot;ך לפי חלוקת המסורה — הפרשיות הפתוחות והסתומות המסורתיות
				שבטקסט. כל פרשה מוצגת עם הטקסט המדויק שלה, כולל גבולות בתוך פסוק.
			</p>
			{HELEK_ORDER.map((helek) => (
				<section key={helek} className={styles.helekSection}>
					<h2 className={styles.helekHeading}>{helek}</h2>
					<ul className={styles.seferList}>
						{sefarim
							.filter((sefer) => sefer.helek === helek)
							.map((sefer) => {
								const first = firstUnitBySefer.get(sefer.name);
								const unitCount = getMasoraUnitsForSefer(
									sefer.name,
								).length;
								return (
									<li key={sefer.name} className={styles.seferItem}>
										{first ? (
											<Link
												href={`${MASORA_DIVISION.rootPath}/${first.unitId}`}
												className={styles.seferLink}
											>
												<span className={styles.seferName}>{sefer.name}</span>
												<span className={styles.unitCount}>
													{unitCount} פרשות
												</span>
											</Link>
										) : (
											<span className={styles.seferName}>{sefer.name}</span>
										)}
									</li>
								);
							})}
					</ul>
				</section>
			))}
		</div>
	);
}
