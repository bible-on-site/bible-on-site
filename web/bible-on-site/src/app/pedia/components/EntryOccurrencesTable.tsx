import { toLetters } from "gematry";
import Link from "next/link";
import { Fragment } from "react";
import type { Segment } from "@/data/db/tanah-view-types";
import { isQriDifferentThanKtiv } from "@/data/db/tanah-view-types";
import { getPerekByPerekId } from "@/data/perek-dto";
import type { EntryTanahOccurrence } from "@/lib/tanahpedia/service";
import styles from "./entry-occurrences.module.css";

function OccurrenceCitation({
	segments,
	ranges,
}: {
	segments: Segment[];
	ranges: EntryTanahOccurrence[];
}) {
	const lastTextIndex = segments.findLastIndex((segment) => "value" in segment);
	return segments.map((segment, index) => {
		if (segment.type === "ptuha" || segment.type === "stuma") return null;
		const matched = ranges.some(
			(range) =>
				range.segmentStart === null ||
				range.segmentEnd === null ||
				(index >= range.segmentStart && index <= range.segmentEnd),
		);
		const text =
			segment.type === "qri" && isQriDifferentThanKtiv(segment)
				? `(${segment.value})`
				: segment.value;
		return (
			// biome-ignore lint/suspicious/noArrayIndexKey: references address immutable canonical segment positions
			<Fragment key={index}>
				{matched ? <strong className={styles.occurrence}>{text}</strong> : text}
				{index < lastTextIndex && !segment.value.endsWith("־") ? " " : null}
			</Fragment>
		);
	});
}

export function EntryOccurrencesTable({
	occurrences,
}: {
	occurrences: EntryTanahOccurrence[];
}) {
	const verses = new Map<string, EntryTanahOccurrence[]>();
	for (const occurrence of occurrences) {
		const key = `${occurrence.perekId}:${occurrence.pasukNumber}`;
		const ranges = verses.get(key);
		if (ranges) ranges.push(occurrence);
		else verses.set(key, [occurrence]);
	}
	const rows = [...verses.entries()].flatMap(([key, ranges]) => {
		const { perekId, pasukNumber } = ranges[0];
		if (!Number.isInteger(perekId) || perekId < 1 || perekId > 929) return [];
		const perek = getPerekByPerekId(perekId);
		const pasuk = perek.pesukim[pasukNumber - 1];
		if (!Number.isInteger(pasukNumber) || !pasuk) return [];
		return [{ key, perek, pasukNumber, segments: pasuk.segments, ranges }];
	});
	if (rows.length === 0) return null;

	return (
		<section
			className={styles.section}
			aria-labelledby="entry-occurrences-heading"
		>
			<h2 id="entry-occurrences-heading" className={styles.heading}>
				מופעים בתנ״ך
			</h2>
			<table className={styles.table}>
				<thead>
					<tr>
						<th scope="col">מקור</th>
						<th scope="col">ציטוט</th>
					</tr>
				</thead>
				<tbody>
					{rows.map(({ key, perek, pasukNumber, segments, ranges }) => (
						<tr key={key}>
							<td className={styles.source}>
								<Link
									href={`/929/${perek.perekId}#pasuk-${pasukNumber}`}
									prefetch={false}
								>
									{perek.source}, {toLetters(pasukNumber)}
								</Link>
							</td>
							<td className={styles.citation}>
								<OccurrenceCitation segments={segments} ranges={ranges} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);
}
