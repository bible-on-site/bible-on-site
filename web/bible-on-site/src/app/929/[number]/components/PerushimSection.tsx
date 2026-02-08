"use client";

import DOMPurify from "isomorphic-dompurify";
import { toLetters } from "gematry";
import { useState } from "react";
import type { PerushDetail, PerushNote, PerushSummary } from "@/lib/perushim";
import { getPerushNotesForPage } from "../actions";
import styles from "./perushim-section.module.css";

interface PerushimSectionProps {
	perekId: number;
	perushim?: PerushSummary[] | null;
}

/**
 * Renders perushim (commentaries) for a perek as a horizontal carousel.
 * Clicking a perush expands to show all its notes for the perek, grouped by pasuk.
 */
export function PerushimSection({
	perekId,
	perushim = [],
}: PerushimSectionProps) {
	const safePerushim = perushim ?? [];
	const [selected, setSelected] = useState<PerushDetail | null>(null);
	const [loading, setLoading] = useState(false);

	async function handlePerushClick(perush: PerushSummary) {
		setLoading(true);
		try {
			const notes = await getPerushNotesForPage(perush.id, perekId);
			setSelected({
				id: perush.id,
				name: perush.name,
				parshanName: perush.parshanName,
				notes,
			});
		} catch {
			setSelected(null);
		} finally {
			setLoading(false);
		}
	}

	function handleBack() {
		setSelected(null);
	}

	if (selected) {
		return (
			<PerushFullView
				perush={selected}
				onBack={handleBack}
			/>
		);
	}

	return (
		<section className={styles.perushimSection} aria-busy={loading}>
			<header className={styles.sectionHeader}>
				<span className={styles.sectionIcon}>📖</span>
				<h2 className={styles.sectionTitle}>פרשנים על הפרק</h2>
			</header>

			<div className={styles.carousel}>
				{safePerushim.length === 0 ? (
					<p className={styles.emptyMessage}>אין פרשנות לפרק זה</p>
				) : loading ? (
					<p className={styles.emptyMessage}>טוען פירוש...</p>
				) : (
					safePerushim.map((perush) => (
						<button
							key={perush.id}
							type="button"
							className={styles.carouselItem}
							onClick={() => handlePerushClick(perush)}
						>
							<div className={styles.perushIcon}>📜</div>
							<span className={styles.perushName}>{perush.name}</span>
							<span className={styles.parshanName}>{perush.parshanName}</span>
							<span className={styles.noteCount}>
								{perush.noteCount} פסוקים
							</span>
						</button>
					))
				)}
			</div>
		</section>
	);
}

// ─── Full view (inline, similar to ArticleFullView) ─────────────────────────

interface PerushFullViewProps {
	perush: PerushDetail;
	onBack: () => void;
}

function PerushFullView({ perush, onBack }: PerushFullViewProps) {
	// Group notes by pasuk
	const grouped = new Map<number, PerushNote[]>();
	for (const note of perush.notes) {
		const arr = grouped.get(note.pasuk) ?? [];
		arr.push(note);
		grouped.set(note.pasuk, arr);
	}

	return (
		<section className={styles.perushimSection}>
			<header className={styles.fullViewHeader}>
				<button
					type="button"
					className={styles.backButton}
					onClick={onBack}
				>
					חזרה לפרשנים &larr;
				</button>
				<div className={styles.fullViewTitle}>
					<h2 className={styles.sectionTitle}>{perush.name}</h2>
					<span className={styles.parshanSubtitle}>
						{perush.parshanName}
						{perush.parshanBirthYear != null && (
							<> ({perush.parshanBirthYear})</>
						)}
					</span>
				</div>
			</header>

			<div className={styles.notesContainer}>
				{Array.from(grouped.entries()).map(([pasuk, notes]) => (
					<div key={pasuk} className={styles.pasukGroup}>
						<div className={styles.pasukLabel}>פסוק {toLetters(pasuk)}</div>
						{notes.map((note) => (
							<div
								key={`${note.pasuk}-${note.noteIdx}`}
								className={styles.noteContent}
								// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
								dangerouslySetInnerHTML={{
									__html: DOMPurify.sanitize(note.noteContent),
								}}
							/>
						))}
					</div>
				))}
			</div>
		</section>
	);
}
