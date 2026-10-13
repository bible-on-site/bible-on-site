"use client";

import { toLetters } from "gematry";
import DOMPurify from "isomorphic-dompurify";
import type { PerushDetail, PerushNote } from "@/lib/perushim";
import styles from "./perushim-section.module.css";
import { scrollToSeferPasuk } from "./sefer-pasuk-navigation";
import { ShareButton } from "./ShareButton";
import seferStyles from "./sefer.module.css";

interface PerushFullViewProps {
	perush: PerushDetail;
	onBack: () => void;
	/** When true, layout fills container: header fixed, notes scroll (flipbook blank page). */
	fullPage?: boolean;
	/** Perek ID for constructing canonical sharing URL. */
	perekId?: number;
}

/**
 * Renders a single perush (title, parshan, notes grouped by pasuk) with a back action.
 * Used on the flipbook blank page when the user clicks a perush from the carousel;
 * outside the book the dedicated /929/{perek}/{perush} page is the single view.
 */
export function PerushFullView({
	perush,
	onBack,
	fullPage = false,
	perekId,
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

	const canonicalPath = perekId
		? `/929/${perekId}/${encodeURIComponent(perush.name)}`
		: null;

	return (
		<section
			className={rootClass}
			data-flipbook-no-flip
			data-sefer-perush={perush.name}
			data-sefer-perush-perek={perekId}
		>
			<header className={styles.fullViewHeader}>
				<button type="button" className={styles.backButton} onClick={onBack}>
					&rarr; חזרה לפרשנים
				</button>
				<div className={styles.fullViewTitle}>
					<h2 className={styles.sectionTitle}>{perush.name}</h2>
					<span className={styles.parshanSubtitle}>{perush.parshanName}</span>
				</div>
				{canonicalPath && (
					<ShareButton
						canonicalPath={canonicalPath}
						title={`${perush.name} - ${perush.parshanName}`}
					/>
				)}
			</header>

			<div className={notesClass}>
				{Array.from(grouped.entries()).map(([pasuk, notes]) => (
					<div
						key={pasuk}
						className={styles.pasukGroup}
						data-perush-pasuk={pasuk}
					>
						{perekId ? (
							<button
								type="button"
								className={`${styles.pasukLabel} ${styles.pasukLink}`}
								data-flipbook-no-flip
								title={`מעבר לפסוק ${toLetters(pasuk)} בפרק`}
								aria-label={`מעבר לפסוק ${toLetters(pasuk)} בפרק`}
								onClick={() => scrollToSeferPasuk(perekId, pasuk)}
							>
								פסוק {toLetters(pasuk)}
							</button>
						) : (
							<div className={styles.pasukLabel}>
								פסוק {toLetters(pasuk)}
							</div>
						)}
						{notes.map((note) => (
							<div
								key={`${note.pasuk}-${note.noteIdx}`}
								id={`book-note-${toLetters(note.pasuk)}-${note.noteIdx + 1}`}
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
