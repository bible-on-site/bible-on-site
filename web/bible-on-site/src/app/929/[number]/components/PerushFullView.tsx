"use client";

import { toLetters } from "gematry";
import DOMPurify from "isomorphic-dompurify";
import type { PerushDetail, PerushNote } from "@/lib/perushim";
import styles from "./perushim-section.module.css";
import seferStyles from "./sefer.module.css";

interface PerushFullViewProps {
	perush: PerushDetail;
	onBack: () => void;
	/** When true, layout fills container: header fixed, notes scroll (flipbook blank page). */
	fullPage?: boolean;
}

/**
 * Renders a single perush (title, parshan, notes grouped by pasuk) with a back action.
 * Used both in the SEO view (inline) and flipbook blank page (fullPage).
 */
export function PerushFullView({
	perush,
	onBack,
	fullPage = false,
}: PerushFullViewProps) {
	// Group notes by pasuk
	const grouped = new Map<number, PerushNote[]>();
	for (const note of perush.notes) {
		const arr = grouped.get(note.pasuk) ?? [];
		arr.push(note);
		grouped.set(note.pasuk, arr);
	}

	const rootClass = fullPage
		? `${styles.perushimSection} ${seferStyles.perushFullViewInBook}`
		: styles.perushimSection;

	const notesClass = fullPage
		? `${styles.notesContainer} ${seferStyles.perushNotesInBook}`
		: styles.notesContainer;

	return (
		<section className={rootClass}>
			<header className={styles.fullViewHeader}>
				<button type="button" className={styles.backButton} onClick={onBack}>
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

			<div className={notesClass}>
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
