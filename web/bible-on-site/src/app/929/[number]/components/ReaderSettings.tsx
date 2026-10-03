"use client";
import { useCallback, useEffect, useState } from "react";
import {
	applyReaderSettings,
	DEFAULT_READER_SETTINGS,
	getStoredReaderSettings,
	PEREK_FONT_SCALES,
	PEREK_LINE_HEIGHTS,
	type ReaderSettings as ReaderSettingsState,
	setStoredReaderSettings,
} from "@/lib/reader-settings";
import styles from "./reader-settings.module.css";

/**
 * Font-size and line-spacing controls for the perek text. Sits in the top
 * strip next to ReadModeToggler; visible on mobile too (the toggler is
 * tablet+ only, but reading settings apply to the basic view as well).
 */
export default function ReaderSettings() {
	const [settings, setSettings] =
		useState<ReaderSettingsState>(DEFAULT_READER_SETTINGS);

	// The inline bootstrap script in the layout already applied the stored
	// settings to <html> before first paint; this only syncs the control's
	// own state, so there is no text flash and no hydration mismatch.
	useEffect(() => {
		setSettings(getStoredReaderSettings());
	}, []);

	const update = useCallback(
		(patch: Partial<ReaderSettingsState>) => {
			const next = { ...settings, ...patch };
			setSettings(next);
			setStoredReaderSettings(next);
			applyReaderSettings(next);
		},
		[settings],
	);

	const fontAtMin = settings.fontStep <= 0;
	const fontAtMax = settings.fontStep >= PEREK_FONT_SCALES.length - 1;

	return (
		<fieldset
			className={styles.container}
			aria-label="הגדרות קריאה"
			data-testid="reader-settings"
		>
			<button
				type="button"
				className={styles.button}
				onClick={() => update({ fontStep: settings.fontStep - 1 })}
				disabled={fontAtMin}
				aria-label="הקטנת גופן"
				data-testid="reader-font-decrease"
			>
				א-
			</button>
			<button
				type="button"
				className={styles.button}
				onClick={() => update({ fontStep: settings.fontStep + 1 })}
				disabled={fontAtMax}
				aria-label="הגדלת גופן"
				data-testid="reader-font-increase"
			>
				א+
			</button>
			<button
				type="button"
				className={styles.button}
				onClick={() =>
					update({
						lineStep: (settings.lineStep + 1) % PEREK_LINE_HEIGHTS.length,
					})
				}
				aria-label={`ריווח שורות: רמה ${settings.lineStep + 1} מתוך ${PEREK_LINE_HEIGHTS.length}`}
				data-testid="reader-line-spacing"
			>
				<svg
					width="18"
					height="18"
					viewBox="0 0 20 20"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<line x1="3" y1="5" x2="13" y2="5" />
					<line x1="3" y1="10" x2="13" y2="10" />
					<line x1="3" y1="15" x2="13" y2="15" />
					<polyline points="15.5,6.5 17,4.5 18.5,6.5" />
					<polyline points="15.5,13.5 17,15.5 18.5,13.5" />
				</svg>
			</button>
		</fieldset>
	);
}
