"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	DEFAULT_DIVINE_NAME_MASKING,
	type DivineNameKey,
	type DivineNameMaskingSettings,
} from "@/lib/divine-name-masking";
import {
	DIVINE_NAME_MASKING_EVENT,
	DIVINE_NAME_MASKING_KEY,
	getDivineNameMaskingSettings,
	saveDivineNameMaskingSettings,
} from "@/lib/divine-name-settings";
import {
	applyReaderSettings,
	DEFAULT_READER_SETTINGS,
	getStoredReaderSettings,
	PEREK_FONT_SCALES,
	PEREK_LINE_HEIGHTS,
	PEREK_TANAKH_FONTS,
	PEREK_WORD_SPACINGS,
	READER_SETTINGS_EVENT,
	READER_SETTINGS_STORAGE_KEY,
	type ReaderSettings as ReaderState,
	setStoredReaderSettings,
} from "@/lib/reader-settings";
import {
	DEFAULT_RECITATION_SETTINGS,
	getRecitationSettings,
	OPEN_READER_SETTINGS_EVENT,
	type OpenReaderSettingsDetail,
	RECITATION_SETTINGS_EVENT,
	RECITATION_SETTINGS_KEY,
	type RecitationSettings,
	type SettingsSection,
	saveRecitationSettings,
} from "@/lib/recitation-settings";
import {
	DEFAULT_SEFER_BOOKMARK_SETTINGS,
	getSeferBookmarkSettings,
	SEFER_BOOKMARKS_EVENT,
	SEFER_BOOKMARKS_KEY,
	type SeferBookmarkSettings,
	saveSeferBookmarkSettings,
} from "@/lib/sefer-bookmark-settings";
import styles from "./reader-settings.module.css";
import SettingsIcon from "./SettingsIcon";

/** Per-name הסתר שם השם radio options; labels show the resulting spelling. */
const MASK_OPTIONS: Record<
	DivineNameKey,
	{ option: string; label: string; custom?: boolean }[]
> = {
	elohim: [
		{ option: "asis", label: "אלהים" },
		{ option: "elokim", label: "אלקים" },
		{ option: "hyphen", label: "א-להים" },
		{ option: "custom", label: "אחר", custom: true },
	],
	yhwh: [
		{ option: "heh", label: "ה'" },
		{ option: "dalet", label: "ד'" },
		{ option: "custom", label: "אחר", custom: true },
	],
	el: [
		{ option: "asis", label: "אל" },
		{ option: "hyphen", label: "א-ל" },
	],
	shaddai: [
		{ option: "asis", label: "שדי" },
		{ option: "hyphen", label: "שד-י" },
		{ option: "custom", label: "אחר", custom: true },
	],
};

const MASK_NAMES: Record<DivineNameKey, string> = {
	elohim: "אלהים",
	yhwh: "יהוה",
	el: "אל",
	shaddai: "שדי",
};

export default function ReaderSettings() {
	const [display, setDisplay] = useState<ReaderState>(DEFAULT_READER_SETTINGS);
	const [recitation, setRecitation] = useState<RecitationSettings>(
		DEFAULT_RECITATION_SETTINGS,
	);
	const [masking, setMasking] = useState<DivineNameMaskingSettings>(
		DEFAULT_DIVINE_NAME_MASKING,
	);
	const [bookmarks, setBookmarks] = useState<SeferBookmarkSettings>(
		DEFAULT_SEFER_BOOKMARK_SETTINGS,
	);
	const [section, setSection] = useState<SettingsSection>("display");
	const [scoped, setScoped] = useState(false);
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const dialog = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const updateDisplay = (patch: Partial<ReaderState>) => {
		const next = { ...display, ...patch };
		setDisplay(next);
		setStoredReaderSettings(next);
		applyReaderSettings(next);
	};
	const updateRecitation = (patch: Partial<RecitationSettings>) =>
		saveRecitationSettings({ ...recitation, ...patch });
	const updateMasking = (patch: Partial<DivineNameMaskingSettings>) =>
		saveDivineNameMaskingSettings({ ...masking, ...patch });
	// Backs up the disabled fieldset: per-name choices only change while on.
	const updateMaskingChoice = (patch: Partial<DivineNameMaskingSettings>) => {
		if (masking.enabled) updateMasking(patch);
	};
	const updateBookmarks = (patch: Partial<SeferBookmarkSettings>) =>
		saveSeferBookmarkSettings({ ...bookmarks, ...patch });
	// Option edits while the layer is hidden would be invisible — the
	// disabled fieldset mirrors masking's own guard.
	const updateBookmarksChoice = (patch: Partial<SeferBookmarkSettings>) => {
		if (bookmarks.enabled) updateBookmarks(patch);
	};
	const close = useCallback(() => {
		dialog.current?.close();
		setAnchor(null);
		anchor?.focus();
	}, [anchor]);
	useEffect(() => {
		setDisplay(getStoredReaderSettings());
		setRecitation(getRecitationSettings());
		setMasking(getDivineNameMaskingSettings());
		setBookmarks(getSeferBookmarkSettings());
		const updated = (event: Event) =>
			setRecitation((event as CustomEvent<RecitationSettings>).detail);
		// Same-tab writes from the top-nav accessibility menu dispatch through
		// READER_SETTINGS_EVENT; the panel mirrors them so both controls agree.
		const displayUpdated = (event: Event) =>
			setDisplay((event as CustomEvent<ReaderState>).detail);
		const maskingUpdated = (event: Event) =>
			setMasking((event as CustomEvent<DivineNameMaskingSettings>).detail);
		const bookmarksUpdated = (event: Event) =>
			setBookmarks((event as CustomEvent<SeferBookmarkSettings>).detail);
		// Cross-tab storage events fire for every key — only re-read the
		// preferences this panel actually shows, so unrelated writes elsewhere
		// in another tab don't churn its controls.
		const OWNED_KEYS = new Set<string>([
			READER_SETTINGS_STORAGE_KEY,
			RECITATION_SETTINGS_KEY,
			DIVINE_NAME_MASKING_KEY,
			SEFER_BOOKMARKS_KEY,
		]);
		const stored = (event: StorageEvent) => {
			if (!OWNED_KEYS.has(event.key ?? "")) return;
			setDisplay(getStoredReaderSettings());
			setRecitation(getRecitationSettings());
			setMasking(getDivineNameMaskingSettings());
			setBookmarks(getSeferBookmarkSettings());
			applyReaderSettings(getStoredReaderSettings());
		};
		const opened = (event: Event) => {
			const detail = (event as CustomEvent<OpenReaderSettingsDetail>).detail;
			setSection(detail.section);
			setScoped(detail.scoped);
			setAnchor(detail.opener);
		};
		window.addEventListener(OPEN_READER_SETTINGS_EVENT, opened);
		window.addEventListener(RECITATION_SETTINGS_EVENT, updated);
		window.addEventListener(READER_SETTINGS_EVENT, displayUpdated);
		window.addEventListener(DIVINE_NAME_MASKING_EVENT, maskingUpdated);
		window.addEventListener(SEFER_BOOKMARKS_EVENT, bookmarksUpdated);
		window.addEventListener("storage", stored);
		return () => {
			window.removeEventListener(OPEN_READER_SETTINGS_EVENT, opened);
			window.removeEventListener(RECITATION_SETTINGS_EVENT, updated);
			window.removeEventListener(READER_SETTINGS_EVENT, displayUpdated);
			window.removeEventListener(DIVINE_NAME_MASKING_EVENT, maskingUpdated);
			window.removeEventListener(SEFER_BOOKMARKS_EVENT, bookmarksUpdated);
			window.removeEventListener("storage", stored);
		};
	}, []);
	useEffect(() => {
		if (!anchor || !dialog.current) return;
		const panel = dialog.current;
		panel.showModal();
		// Using the panel must not count as an outside click for popovers under
		// it (the download menu keeps its selected range while settings change).
		const keepUnderlyingOpen = (event: MouseEvent) => event.stopPropagation();
		panel.addEventListener("mousedown", keepUnderlyingOpen);
		const position = () => {
			const box = anchor.getBoundingClientRect();
			panel.style.left = `${Math.max(12, Math.min(box.left, window.innerWidth - panel.offsetWidth - 12))}px`;
			panel.style.top = `${Math.max(12, Math.min(box.bottom + 8, window.innerHeight - panel.offsetHeight - 12))}px`;
		};
		position();
		window.addEventListener("resize", position);
		window.addEventListener("scroll", position, true);
		return () => {
			panel.close();
			panel.removeEventListener("mousedown", keepUnderlyingOpen);
			window.removeEventListener("resize", position);
			window.removeEventListener("scroll", position, true);
		};
	}, [anchor]);
	useEffect(() => {
		if (anchor)
			dialog.current
				?.querySelector<HTMLInputElement>(
					section === "display"
						? 'input[aria-label="גודל גופן"]'
						: 'input[aria-label="מהירות"]',
				)
				?.focus();
	}, [anchor, section]);
	return (
		<>
			<div className={styles.container} data-testid="reader-settings">
				<button
					type="button"
					className={styles.button}
					aria-label="הגדרות קריאה"
					aria-haspopup="dialog"
					aria-expanded={Boolean(anchor)}
					onClick={(event) => {
						setSection("display");
						setScoped(false);
						setAnchor(event.currentTarget);
					}}
				>
					<SettingsIcon />
				</button>
			</div>
			{anchor &&
				createPortal(
					<dialog
						ref={dialog}
						className={styles.panel}
						dir="rtl"
						aria-labelledby={titleId}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								close();
							}
						}}
						onCancel={(event) => {
							event.preventDefault();
							close();
						}}
						onClick={(event) => {
							if (event.target === event.currentTarget) {
								const b = event.currentTarget.getBoundingClientRect();
								if (
									event.clientX < b.left ||
									event.clientX > b.right ||
									event.clientY < b.top ||
									event.clientY > b.bottom
								)
									close();
							}
						}}
					>
						<header className={styles.panelHeader}>
							<strong id={titleId}>
								{scoped && section === "recitation"
									? "הגדרות קריינות"
									: "הגדרות קריאה"}
							</strong>
							<button type="button" aria-label="סגירת הגדרות" onClick={close}>
								×
							</button>
						</header>
						{!scoped && (
							<nav className={styles.categories} aria-label="קטגוריות הגדרות">
								<button
									type="button"
									aria-pressed={section === "display"}
									onClick={() => setSection("display")}
								>
									תצוגה
								</button>
								<button
									type="button"
									aria-pressed={section === "recitation"}
									onClick={() => setSection("recitation")}
								>
									קריינות
								</button>
							</nav>
						)}
						{section === "display" ? (
							<section aria-label="תצוגה" className={styles.section}>
								<label>
									גודל גופן
									<output>
										{Math.round(PEREK_FONT_SCALES[display.fontStep] * 100)}%
									</output>
									<input
										aria-label="גודל גופן"
										type="range"
										min="0"
										max={PEREK_FONT_SCALES.length - 1}
										step="1"
										value={display.fontStep}
										onChange={(e) =>
											updateDisplay({ fontStep: Number(e.target.value) })
										}
									/>
								</label>
								<label>
									ריווח אופקי<output>{display.wordStep + 1}</output>
									<input
										aria-label="ריווח אופקי"
										type="range"
										min="0"
										max={PEREK_WORD_SPACINGS.length - 1}
										step="1"
										value={display.wordStep}
										onChange={(e) =>
											updateDisplay({ wordStep: Number(e.target.value) })
										}
									/>
									<small>רווח בין מילים</small>
								</label>
								<label>
									ריווח אנכי<output>{display.lineStep + 1}</output>
									<input
										aria-label="ריווח אנכי"
										type="range"
										min="0"
										max={PEREK_LINE_HEIGHTS.length - 1}
										step="1"
										value={display.lineStep}
										onChange={(e) =>
											updateDisplay({ lineStep: Number(e.target.value) })
										}
									/>
									<small>רווח בין שורות</small>
								</label>
								<label>
									גופן פסוקים
									<select
										aria-label="גופן פסוקים"
										value={display.fontId}
										onChange={(e) =>
											updateDisplay({ fontId: Number(e.target.value) })
										}
									>
										{PEREK_TANAKH_FONTS.map((font, index) => (
											<option key={font || "default"} value={index}>
												{font === "noto" ? "Noto Serif Hebrew" : "Taamey D"}
											</option>
										))}
									</select>
									<small>גופן טעמים מסורתי</small>
								</label>
								<fieldset
									className={styles.maskingGroup}
									disabled={!masking.enabled}
								>
									<legend>
										<label>
											הסתר שם השם
											<input
												className={styles.maskingToggle}
												type="checkbox"
												checked={masking.enabled}
												onChange={(e) =>
													updateMasking({ enabled: e.target.checked })
												}
											/>
										</label>
									</legend>
									<small>
										הצגת שמות ה' בכתיב מקוצר (למשל ה' וא-להים). ההגדרה חלה על
										התצוגה בלבד
									</small>
									{(Object.keys(MASK_OPTIONS) as DivineNameKey[]).map(
										(name) => (
											<fieldset key={name} className={styles.nameFieldset}>
												<legend>{MASK_NAMES[name]}</legend>
												<div className={styles.nameOptions}>
													{MASK_OPTIONS[name].map(({ option, label }) => (
														<label key={option}>
															<input
																type="radio"
																name={`mask-${name}`}
																value={option}
																checked={masking[name] === option}
																onChange={() =>
																	updateMaskingChoice({
																		[name]: option,
																	} as Partial<DivineNameMaskingSettings>)
																}
															/>
															{label}
														</label>
													))}
												</div>
												{MASK_OPTIONS[name].some((o) => o.custom) && (
													<input
														aria-label={`כתיב חלופי עבור ${MASK_NAMES[name]}`}
														className={styles.customText}
														type="text"
														dir="rtl"
														placeholder="כתיב חלופי"
														value={
															masking[
																`${name}Custom` as keyof DivineNameMaskingSettings
															] as string
														}
														disabled={masking[name] !== "custom"}
														onChange={(e) =>
															updateMaskingChoice({
																[`${name}Custom`]: e.target.value,
															} as Partial<DivineNameMaskingSettings>)
														}
													/>
												)}
											</fieldset>
										),
									)}
								</fieldset>
								<fieldset
									className={styles.maskingGroup}
									disabled={!bookmarks.enabled}
								>
									<legend>
										<label>
											סימניות פרקים
											<input
												className={styles.maskingToggle}
												type="checkbox"
												checked={bookmarks.enabled}
												onChange={(e) =>
													updateBookmarks({ enabled: e.target.checked })
												}
											/>
										</label>
									</legend>
									<small>לשוניות פרקים בשולי הספר לניווט מהיר</small>
									<label>
										מיקום
										<select
											aria-label="מיקום סימניות"
											value={bookmarks.placement}
											onChange={(e) =>
												updateBookmarksChoice({
													placement: e.target
														.value as SeferBookmarkSettings["placement"],
												})
											}
										>
											<option value="sides">שני הצדדים</option>
											<option value="right">ימין</option>
											<option value="left">שמאל</option>
											<option value="top">עליון</option>
											<option value="bottom">תחתון</option>
											<option value="top-bottom">עליון ותחתון</option>
										</select>
									</label>
									<label>
										כיוון
										<select
											aria-label="כיוון סימניות"
											value={bookmarks.orientation}
											onChange={(e) =>
												updateBookmarksChoice({
													orientation: e.target
														.value as SeferBookmarkSettings["orientation"],
												})
											}
										>
											<option value="perpendicular">מאונך לשולי הספר</option>
											<option value="parallel">מקביל לשולי הספר</option>
										</select>
									</label>
									<label>
										קיבוע
										<select
											aria-label="קיבוע סימניות"
											value={bookmarks.attachment}
											onChange={(e) =>
												updateBookmarksChoice({
													attachment: e.target
														.value as SeferBookmarkSettings["attachment"],
												})
											}
										>
											<option value="leaf">מסתובב עם הדף</option>
											<option value="pinned">קבוע לספר</option>
										</select>
									</label>
									<label>
										סדר
										<select
											aria-label="סדר סימניות"
											value={bookmarks.order}
											onChange={(e) =>
												updateBookmarksChoice({
													order: e.target
														.value as SeferBookmarkSettings["order"],
												})
											}
										>
											<option value="page">לפי סדר הפרקים</option>
											<option value="reverse-page">סדר הפוך</option>
											<option value="title">לפי שם הפרק</option>
										</select>
									</label>
									<label>
										<input
											type="checkbox"
											checked={bookmarks.upcomingOnly}
											onChange={(e) =>
												updateBookmarksChoice({
													upcomingOnly: e.target.checked,
												})
											}
										/>
										הצג רק פרקים הבאים
									</label>
								</fieldset>
							</section>
						) : (
							<section aria-label="קריינות" className={styles.section}>
								<label>
									מהירות<output dir="ltr">{recitation.speed}×</output>
									<input
										aria-label="מהירות"
										type="range"
										min="0.5"
										max="2"
										step="0.25"
										value={recitation.speed}
										onChange={(e) =>
											updateRecitation({ speed: Number(e.target.value) })
										}
									/>
								</label>
								<label>
									אורך הפסקה בין פסוקים
									<select
										aria-label="אורך הפסקה בין פסוקים"
										value={recitation.versePauseMs ?? "original"}
										onChange={(e) =>
											updateRecitation({
												versePauseMs:
													e.target.value === "original"
														? null
														: Number(e.target.value),
											})
										}
									>
										<option value="original">לפי ההקלטה</option>
										{[0, 500, 1000, 1500, 2000, 3000, 5000].map((ms) => (
											<option key={ms} value={ms}>
												{ms === 0 ? "ללא הפסקה" : `${ms / 1000} שניות`}
											</option>
										))}
									</select>
									<small>הפסקה מותאמת זמינה בפרקים עם חלוקה לפסוקים</small>
								</label>
								<label>
									עוצמה<output>{Math.round(recitation.volume * 100)}%</output>
									<input
										aria-label="עוצמה"
										type="range"
										min="0"
										max="1"
										step="0.05"
										value={recitation.volume}
										onChange={(e) =>
											updateRecitation({ volume: Number(e.target.value) })
										}
									/>
								</label>
							</section>
						)}
					</dialog>,
					document.body,
				)}
		</>
	);
}
