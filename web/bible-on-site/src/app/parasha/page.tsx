import type { Metadata } from "next";
import Link from "next/link";
import { sefarim } from "@/data/db/sefarim";
import {
	getParashaOccasions,
	getParashaUnitsForSefer,
	PARASHA_DIVISION,
	PARASHA_GENERAL_NOTES,
	PARASHA_JOINED_NOTE,
	PARASHA_JOINED_PAIRS,
	PARASHA_SOURCE_ATTRIBUTION,
	parashaRefSpan,
	rangesRefSpans,
} from "@/data/parasha/parasha-units";
import { SITE_NAME } from "@/lib/seo/jsonld";
import styles from "./page.module.css";

const TORAH_SEFER_NAMES = ["בראשית", "שמות", "ויקרא", "במדבר", "דברים"];

export async function generateMetadata(): Promise<Metadata> {
	const title = `${PARASHA_DIVISION.menuLabel} | ${SITE_NAME}`;
	const description =
		"קריאת פרשיות השבוע עם ההפטרות למנהגי הספרדים, האשכנזים והתימנים - טקסט מלא, פירושים ומאמרים.";
	return {
		title,
		description,
		alternates: { canonical: PARASHA_DIVISION.rootPath },
		openGraph: {
			title,
			description,
			url: PARASHA_DIVISION.rootPath,
			siteName: SITE_NAME,
			locale: "he_IL",
		},
	};
}

/**
 * פרשה root landing — parasha browsing for the weekly Torah-reading
 * division. The primary list covers only the five Torah sefarim;
 * Haftarot stay auxiliary readings inside each parasha (their prophetic
 * sefarim never join this list). Special-Shabbat and festival Haftarot
 * are listed as reference data — the table documents ארץ ישראל
 * practice and is not applied by date.
 */
export default function ParashaLanding() {
	const torahSefarim = sefarim.filter((sefer) =>
		TORAH_SEFER_NAMES.includes(sefer.name),
	);
	const occasions = getParashaOccasions();

	return (
		<div className={styles.container}>
			<h1 className={styles.heading}>{PARASHA_DIVISION.menuLabel}</h1>
			<p className={styles.intro}>
				קריאת פרשיות השבוע של התורה — חמישה-עשר הפרשיות לכל חומש, כל פרשה עם
				קריאת התורה שלה וההפטרה שלה למנהגי הספרדים, האשכנזים והתימנים.
			</p>

			{torahSefarim.map((sefer) => {
				const units = getParashaUnitsForSefer(sefer.name);
				return (
					<section key={sefer.name} className={styles.helekSection}>
						<h2 className={styles.helekHeading}>ספר {sefer.name}</h2>
						<ol className={styles.parashaList}>
							{units.map((unit) => (
								<li key={unit.unitId} className={styles.parashaItem}>
									<Link
										href={`${PARASHA_DIVISION.rootPath}/${unit.slug}`}
										className={styles.seferLink}
									>
										<span className={styles.seferName}>
											פרשת {unit.heading}
										</span>
										<span className={styles.unitCount}>
											{parashaRefSpan(unit)}
										</span>
									</Link>
								</li>
							))}
						</ol>
					</section>
				);
			})}

			<section className={styles.helekSection}>
				<h2 className={styles.helekHeading}>פרשיות מחוברות</h2>
				<p className={styles.intro}>
					בחלק מהשנים קוראים שתי פרשיות יחד בשבת אחת. כל פרשה שומרת על זהותה ועל
					ההפטרה שלה: {PARASHA_JOINED_NOTE}
				</p>
				<ul className={styles.notesList}>
					{PARASHA_JOINED_PAIRS.map(([first, second]) => (
						<li key={`${first}-${second}`}>
							פרשת {first} - פרשת {second}
						</li>
					))}
				</ul>
			</section>

			<section className={styles.helekSection}>
				<h2 className={styles.helekHeading}>הפטרות לשבתות ומועדים מיוחדים</h2>
				<p className={styles.intro}>
					קריאות אלו תלויות באירוע ובמנהג הקהילה — הן מוצגות כאן כחומר עיון
					ואינן מחליפות אוטומטית את ההפטרה של דף הפרשה.
				</p>
				<ul className={styles.occasionList}>
					{occasions.map((occasion) => (
						<li key={occasion.name} className={styles.occasionItem}>
							<h3 className={styles.occasionName}>{occasion.name}</h3>
							{occasion.haftarot.map((haftara) => (
								<p key={haftara.id} className={styles.occasionRef}>
									<span className={styles.occasionCustom}>
										{haftara.label}:
									</span>{" "}
									{rangesRefSpans(haftara.ranges).join(" + ")}
									{haftara.note ? ` (${haftara.note})` : ""}
								</p>
							))}
							{occasion.notes.map((note) => (
								<p key={note} className={styles.occasionNote}>
									{note}
								</p>
							))}
						</li>
					))}
				</ul>
			</section>

			<section className={styles.helekSection}>
				<h2 className={styles.helekHeading}>הערות כלליות</h2>
				<ul className={styles.notesList}>
					{PARASHA_GENERAL_NOTES.map((note) => (
						<li key={note}>{note}</li>
					))}
				</ul>
				<p className={styles.sourceNote}>
					מקור הטבלה: {PARASHA_SOURCE_ATTRIBUTION}
				</p>
			</section>
		</div>
	);
}
