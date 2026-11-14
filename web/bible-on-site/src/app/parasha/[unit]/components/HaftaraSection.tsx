import { SharedUnitText } from "@/app/components/reading/UnitText";
import {
	getParashaEntry,
	PARASHA_CUSTOM_DEFAULT_NOTE,
	PARASHA_JOINED_NOTE,
	PARASHA_JOINED_PAIRS,
	rangesRefSpans,
} from "@/data/parasha/parasha-units";
import type { ReadingUnit } from "@/lib/reading/contract";
import { canonicalPasukCount } from "@/lib/reading/queries";
import type { PerekEntityReference } from "@/lib/tanahpedia/service";
import styles from "../page.module.css";

/**
 * The הפטרה section appended after a parasha's Torah reading. Every
 * variant the source table distinguishes is rendered with its own
 * label — nothing is flattened to a single "default" reading. Variant
 * ranges render through the shared range resolver, so chapter/book
 * jumps and repeated concluding verses show exactly as read. Notes
 * carry the source-table provenance (וי"א alternatives, joined-parasha
 * rules, occasion exceptions).
 */
export function HaftaraSection({
	unit,
	entityRefsByPerek,
}: {
	unit: ReadingUnit;
	entityRefsByPerek: Record<number, PerekEntityReference[]>;
}) {
	const entry = getParashaEntry(unit.unitId);
	const auxReadings = unit.auxiliaryReadings ?? [];
	const joinedPair = PARASHA_JOINED_PAIRS.find((pair) =>
		pair.includes(unit.heading),
	);
	const notes = [
		...entry.notes,
		...(joinedPair
			? [`פרשה מחוברת (${joinedPair.join("-")}) - ${PARASHA_JOINED_NOTE}`]
			: []),
		PARASHA_CUSTOM_DEFAULT_NOTE,
	];

	return (
		<section
			className={styles.haftaraSection}
			aria-labelledby="haftara-heading"
		>
			<h2 id="haftara-heading" className={styles.haftaraHeading}>
				הפטרה
			</h2>
			{auxReadings.map((aux) => {
				const source = entry.haftarot.find((h) => h.id === aux.id);
				return (
					<div key={aux.id} className={styles.haftaraVariant}>
						<h3 className={styles.haftaraVariantHeading}>
							הפטרה - {aux.label}
						</h3>
						<p className={styles.haftaraRef}>
							{rangesRefSpans(aux.ranges).join(" + ")}
						</p>
						<SharedUnitText
							ranges={aux.ranges}
							entityRefsByPerek={entityRefsByPerek}
							pasukCount={canonicalPasukCount}
							scrollScope={aux.id}
							anchorScope={aux.id}
							modestPerekLabels
						/>
						{source?.note && (
							<p className={styles.haftaraNote}>{source.note}</p>
						)}
					</div>
				);
			})}
			{notes.length > 0 && (
				<ul className={styles.parashaNotes}>
					{notes.map((note) => (
						<li key={note}>{note}</li>
					))}
				</ul>
			)}
		</section>
	);
}
