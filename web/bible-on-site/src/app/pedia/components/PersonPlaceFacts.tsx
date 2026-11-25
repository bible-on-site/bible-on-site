import Link from "next/link";
import { entryHref } from "@/lib/tanahpedia/synonym-resolution";
import type { PersonPlaceFact, PersonPlaceFacts } from "@/lib/tanahpedia/types";
import styles from "../page.module.css";

function FactValue({ fact }: { fact: PersonPlaceFact }) {
	if (fact.entryUniqueName) {
		return <Link href={entryHref(fact.entryUniqueName)}>{fact.label}</Link>;
	}
	return <bdi>{fact.label}</bdi>;
}

/**
 * מקום לידה / מקומות פעילות / מקום פטירה של איש — כל עובדה קישור לערך
 * המקום כשהיא מקושרת ליישות, או הטקסט החופשי שנשמר.
 */
export function PersonPlaceFactsSection({
	facts,
}: {
	facts: PersonPlaceFacts;
}) {
	const keyed = (kind: string, values: PersonPlaceFact[]) =>
		values.map((value, index) => ({ key: `${kind}-${index}`, value }));
	const rows: {
		label: string;
		facts: { key: string; value: PersonPlaceFact }[];
	}[] = [];
	if (facts.birth)
		rows.push({ label: "מקום לידה", facts: keyed("birth", [facts.birth]) });
	if (facts.activity.length > 0)
		rows.push({
			label: "מקומות פעילות",
			facts: keyed("activity", facts.activity),
		});
	if (facts.death)
		rows.push({ label: "מקום פטירה", facts: keyed("death", [facts.death]) });
	if (rows.length === 0) return null;
	return (
		<section
			className={styles.personPlacesSection}
			aria-labelledby="person-places-heading"
		>
			<h2 id="person-places-heading" className={styles.sectionTitle}>
				מקומות
			</h2>
			<dl className={styles.personPlacesList}>
				{rows.map((row) => (
					<div key={row.label} className={styles.personPlacesRow}>
						<dt>{row.label}</dt>
						<dd>
							{row.facts.map(({ key, value }, index) => (
								<span key={key}>
									{index > 0 ? " · " : ""}
									<FactValue fact={value} />
								</span>
							))}
						</dd>
					</div>
				))}
			</dl>
		</section>
	);
}
