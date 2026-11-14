"use client";

import { toLetters } from "gematry";
import {
	InlineRecitationControl,
	RecitationPasukControl,
} from "./RecitationPlayer";
import recitationStyles from "./recitation-player.module.css";
import styles from "./sefer.module.css";
import {
	scrollToPerushPasuk,
	useSeferOpenPerush,
} from "./sefer-pasuk-navigation";
import {
	toggleSeferPasuk,
	useSeferPasukSelection,
	useSeferPasukSelectionMode,
} from "./sefer-pasuk-selection";

/**
 * Pasuk number in a book content page. While a perush is open on the facing
 * blank page and annotates this pasuk, activating the number jumps to that
 * pasuk's commentary group; otherwise it keeps its recitation behaviour.
 * While the perek's pasuk-selection mode is on (#2544 item 3), the letter is
 * a selection toggle instead — recitation and navigation stay untouched
 * until the mode exits.
 */
export function SeferPasukNumber({
	perekId,
	pasuk,
}: {
	perekId: number;
	pasuk: number;
}) {
	const openPerush = useSeferOpenPerush(perekId);
	const selectionMode = useSeferPasukSelectionMode(perekId);
	const selected = useSeferPasukSelection(perekId);

	if (selectionMode) {
		const pressed = selected.has(pasuk);
		const label = `${pressed ? "הסרת" : "בחירת"} פסוק ${toLetters(pasuk)}`;
		return (
			<InlineRecitationControl
				className={recitationStyles.pasuk}
				label={label}
				title={label}
				pressed={pressed}
				onActivate={() => toggleSeferPasuk(perekId, pasuk)}
			>
				<span
					className={styles.pasukNum}
					data-pasuk-selected={pressed || undefined}
				>
					{toLetters(pasuk)}
				</span>
			</InlineRecitationControl>
		);
	}
	return (
		<RecitationPasukControl
			pasuk={pasuk}
			onNavigate={
				openPerush?.pesukim.has(pasuk)
					? () => scrollToPerushPasuk(perekId, pasuk)
					: undefined
			}
		>
			<span className={styles.pasukNum}>{toLetters(pasuk)}</span>
		</RecitationPasukControl>
	);
}
