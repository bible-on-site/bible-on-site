"use client";

import { toLetters } from "gematry";
import DOMPurify from "isomorphic-dompurify";
import { useMemo } from "react";
import { demoteHeadings } from "@/lib/html-headings";
import type { RangedPerushNote } from "@/lib/perushim";
import { rangedNotesReadingMetrics } from "@/lib/perushim/ranged-metrics";
import { ReadingProgress } from "@/app/components/ReadingProgress";
import { ReadingTime } from "@/app/components/ReadingTime";
import { ShareButton } from "@/app/929/[number]/components/ShareButton";
import styles from "@/app/929/[number]/components/perushim-section.module.css";
import pageStyles from "@/app/929/[number]/[slug]/page.module.css";
import unitStyles from "./unit-perushim.module.css";

interface PasukGroup {
	perekId: number;
	pasuk: number;
	/** First group of its perek — emits the canonical perek label. */
	firstOfPerek: boolean;
	notes: RangedPerushNote[];
}

interface RangedPerushViewProps {
	/** Perush display name (e.g. רש"י). */
	name: string;
	parshanName: string;
	/** Range-bounded notes — every row carries its canonical perekId. */
	notes: RangedPerushNote[];
	onBack: () => void;
	/** Canonical perek source labels (e.g. "בראשית ג") by perekId. */
	perekSources?: Record<number, string>;
	/** Canonical share URL (the /929 perush page); omitted hides share. */
	sharePath?: string;
	/** Message when the perush resolves to no notes inside the bounds. */
	emptyMessage?: string;
	/** The unit scope this commentary was opened from (e.g. "haftara"). */
	scope?: string;
}

/**
 * A perush bounded to a reading unit's canonical verse bounds — the
 * in-place commentary view of the alternative divisions (issue #2190).
 *
 * Notes group by their complete {perekId, pasuk} identity: identical
 * pasuk numbers in different perakim keep separate groups, so a
 * cross-perek parasha never collides commentary. Groups follow the
 * unit's range order; a canonical perek label precedes each perek's
 * first group — the same mapping the unit scripture applies on perek
 * boundaries. Pasuk labels hash-link to the unit text's canonical
 * anchors (`pasuk-{perekId}-{pasuk}`), which ScrollToUnitPasuk resolves
 * for primary and auxiliary (scope-suffixed) readings alike.
 */
export function RangedPerushView({
	name,
	parshanName,
	notes,
	onBack,
	perekSources,
	sharePath,
	emptyMessage = "אין פירושים לפרשה זו",
	scope,
}: RangedPerushViewProps) {
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
			className={`${styles.perushimSection} ${unitStyles.rangedPerushSection}`}
			data-flipbook-no-flip
			data-unit-perush={name}
			data-unit-perush-scope={scope}
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

			<div className={styles.notesContainer}>
				{/* The notes container is its own nested scroller — the bar
				 * sticks to its top edge and measures the note elements it
				 * scrolls past, keyed by `data-reading-unit`. */}
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
								data-perush-pasuk={group.pasuk}
								data-perush-perek={group.perekId}
							>
								{multiPerek && group.firstOfPerek && perekLabel && (
									<span className={unitStyles.perekContext}>{perekLabel}</span>
								)}
								<a
									className={`${styles.pasukLabel} ${styles.pasukLink} ${unitStyles.pasukAnchor}`}
									href={`#pasuk-${group.perekId}-${group.pasuk}`}
									title={`מעבר לפסוק ${letters} בפרשה`}
									aria-label={`מעבר לפסוק ${letters} בפרשה`}
								>
									פסוק {letters}
								</a>
								{group.notes.map((note) => (
									<div
										key={`${note.perekId}-${note.pasuk}-${note.noteIdx}`}
										className={styles.noteContent}
										data-reading-unit={`${note.perekId}:${note.pasuk}:${note.noteIdx}`}
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
