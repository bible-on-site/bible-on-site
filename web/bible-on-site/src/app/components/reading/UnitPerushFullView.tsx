"use client";

import { toLetters } from "gematry";
import DOMPurify from "isomorphic-dompurify";
import { useMemo } from "react";
import styles from "@/app/929/[number]/components/perushim-section.module.css";
import { ShareButton } from "@/app/929/[number]/components/ShareButton";
import seferStyles from "@/app/929/[number]/components/sefer.module.css";
import pageStyles from "@/app/929/[number]/[slug]/page.module.css";
import { demoteHeadings } from "@/lib/html-headings";
import type { RangedPerushNote } from "@/lib/perushim";
import { rangedNotesReadingMetrics } from "@/lib/perushim/ranged-metrics";
import { ReadingProgress } from "@/app/components/ReadingProgress";
import { ReadingTime } from "@/app/components/ReadingTime";
import unitStyles from "./unit-book.module.css";
import { scrollToUnitTextPasuk } from "./unit-book-navigation";

interface PasukGroup {
	perekId: number;
	pasuk: number;
	/** First group of its perek — emits the canonical perek label. */
	firstOfPerek: boolean;
	notes: RangedPerushNote[];
}

interface UnitPerushFullViewProps {
	/** Perush display name (e.g. רש"י). */
	name: string;
	parshanName: string;
	/** Range-bounded notes — every row carries its canonical perekId. */
	notes: RangedPerushNote[];
	onBack: () => void;
	/** Facing text page key for pasuk navigation (`{unitId}:{scope}`). */
	bookKey: string;
	/** Canonical perek source labels (e.g. "בראשית ג") by perekId. */
	perekSources?: Record<number, string>;
	/** Canonical share URL (the unit's perush deep link); omitted hides share. */
	sharePath?: string;
	/** Message when the perush resolves to no notes inside the bounds. */
	emptyMessage?: string;
}

/**
 * A perush bounded to a reading unit's canonical verse bounds, shown on
 * the unit's blank page inside the sefer book (issue #2191).
 *
 * Notes group by their complete {perekId, pasuk} identity: identical
 * pasuk numbers in different perakim keep separate groups, so a
 * cross-perek parasha never collides commentary. Groups follow the
 * unit's range order; a canonical perek label precedes each perek's
 * first group — the same mapping the unit scripture applies on perek
 * boundaries. Pasuk labels scroll the *facing* unit text page (never a
 * global anchor jump — boundary pesukim may exist in neighbouring
 * units' pages too).
 */
export function UnitPerushFullView({
	name,
	parshanName,
	notes,
	onBack,
	bookKey,
	perekSources,
	sharePath,
	emptyMessage = "אין פירושים לפרשה זו",
}: UnitPerushFullViewProps) {
	const { groups, multiPerek } = useMemo(() => {
		const result: PasukGroup[] = [];
		const perekIds = new Set<number>();
		for (const note of notes) {
			perekIds.add(note.perekId);
			const last = result[result.length - 1];
			if (last && last.perekId === note.perekId && last.pasuk === note.pasuk) {
				last.notes.push(note);
			} else {
				result.push({
					perekId: note.perekId,
					pasuk: note.pasuk,
					firstOfPerek: last?.perekId !== note.perekId,
					notes: [note],
				});
			}
		}
		return { groups: result, multiPerek: perekIds.size > 1 };
	}, [notes]);

	// Persisted note metrics (#3108): an unknown count anywhere in the
	// range leaves metric/units absent — no badge, no progress bar.
	const { metric, units } = useMemo(
		() => rangedNotesReadingMetrics(notes),
		[notes],
	);

	return (
		<section
			className={`${styles.perushimSection} ${seferStyles.perushFullViewInBook}`}
			data-flipbook-no-flip
			data-sefer-unit-perush={bookKey}
		>
			<header className={styles.fullViewHeader}>
				<button type="button" className={styles.backButton} onClick={onBack}>
					&rarr; חזרה לפרשנים
				</button>
				<div className={styles.fullViewTitle}>
					<h2 className={styles.sectionTitle}>{name}</h2>
					<span className={styles.parshanSubtitle}>{parshanName}</span>
					<ReadingTime
						estimatedSeconds={metric?.estimatedSeconds}
						className={pageStyles.readingTime}
					/>
				</div>
				{sharePath && (
					<ShareButton
						canonicalPath={sharePath}
						title={`${name} - ${parshanName}`}
					/>
				)}
			</header>

			<div
				className={`${styles.notesContainer} ${seferStyles.perushNotesInBook}`}
			>
				{/* The notes container is the book page's nested scroller —
				 * the bar sticks to its top edge and measures the note
				 * elements it scrolls past, keyed by `data-reading-unit`. */}
				<ReadingProgress
					units={units}
					scroller={`.${styles.notesContainer}`}
					content={`.${styles.notesContainer}`}
					unitSelector='[data-reading-unit="{key}"]'
					stickyTop="0px"
				/>
				{groups.length === 0 ? (
					<p className={styles.emptyMessage}>{emptyMessage}</p>
				) : (
					groups.map((group) => {
						const letters = toLetters(group.pasuk);
						const perekLabel = perekSources?.[group.perekId];
						return (
							<div
								key={`${group.perekId}-${group.pasuk}`}
								className={styles.pasukGroup}
								data-unit-perush-pasuk={`${group.perekId}-${group.pasuk}`}
							>
								{multiPerek && group.firstOfPerek && perekLabel && (
									<span className={unitStyles.perekContext}>{perekLabel}</span>
								)}
								<button
									type="button"
									className={`${styles.pasukLabel} ${styles.pasukLink} ${unitStyles.pasukButton}`}
									data-flipbook-no-flip
									title={`מעבר לפסוק ${letters} בפרשה`}
									aria-label={`מעבר לפסוק ${letters} בפרשה`}
									onClick={() =>
										scrollToUnitTextPasuk(bookKey, group.perekId, group.pasuk)
									}
								>
									פסוק {letters}
								</button>
								{/* Codacy anchors the XSS finding at this map
								 * expression, so the nosemgrep suppression must
								 * sit here rather than beside the attribute. */}
								{/* nosemgrep -- DOMPurify-sanitized perush note */}
								{group.notes.map((note) => (
									<div
										key={`${note.perekId}-${note.pasuk}-${note.noteIdx}`}
										className={styles.noteContent}
										data-reading-unit={`${note.perekId}:${note.pasuk}:${note.noteIdx}`}
										// nosemgrep -- DOMPurify-sanitized perush note
										// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
										dangerouslySetInnerHTML={{
											__html: DOMPurify.sanitize(demoteHeadings(note.noteContent)),
										}}
									/>
								))}
							</div>
						);
					})
				)}
			</div>
		</section>
	);
}
