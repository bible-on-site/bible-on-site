"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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
	type ReaderSettings,
	setStoredReaderSettings,
} from "@/lib/reader-settings";
import { hasReaderSettingsGear, isReaderPathname } from "./TopNavSearch";
import styles from "./top-nav-accessibility.module.css";

const PANEL_ID = "top-nav-accessibility-panel";

const sameSettings = (a: ReaderSettings, b: ReaderSettings) =>
	a.fontStep === b.fontStep &&
	a.lineStep === b.lineStep &&
	a.wordStep === b.wordStep &&
	a.fontId === b.fontId;

/**
 * Accessibility adjustments menu in the shared top bar, next to the search
 * button — or next to the reader preferences gear on reader unit routes,
 * where the search button is intentionally absent. On reader-section routes
 * that suppress the search button but mount no gear (e.g. /929/authors) the
 * trigger takes the left-edge slot instead of docking beside a missing gear.
 * The controls reuse the perek reader display settings so they stay in sync
 * with the הגדרות קריאה dialog instead of competing with it. The reset
 * restores only those display adjustments —
 * unrelated preferences, recitation settings and user data are untouched.
 * The last item is the maintained הצהרת נגישות link (issue #2396).
 */
export function TopNavAccessibility() {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const [settings, setSettings] = useState<ReaderSettings>(
		DEFAULT_READER_SETTINGS,
	);
	const [announce, setAnnounce] = useState("");
	const [lastPathname, setLastPathname] = useState(pathname);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	// Route changes dismiss the popover (same convention as NavBar).
	if (pathname !== lastPathname) {
		setLastPathname(pathname);
		setOpen(false);
		setAnnounce("");
	}

	const close = useCallback((restoreFocus = true) => {
		setOpen(false);
		if (restoreFocus) triggerRef.current?.focus();
	}, []);

	useEffect(() => {
		setSettings(getStoredReaderSettings());
		const updated = (event: Event) =>
			setSettings((event as CustomEvent<ReaderSettings>).detail);
		const stored = (event: StorageEvent) => {
			if (event.key === null || event.key === READER_SETTINGS_STORAGE_KEY)
				setSettings(getStoredReaderSettings());
		};
		window.addEventListener(READER_SETTINGS_EVENT, updated);
		window.addEventListener("storage", stored);
		return () => {
			window.removeEventListener(READER_SETTINGS_EVENT, updated);
			window.removeEventListener("storage", stored);
		};
	}, []);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				close();
			}
		};
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (
				!panelRef.current?.contains(target) &&
				!triggerRef.current?.contains(target)
			)
				close(false);
		};
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("pointerdown", onPointerDown);
		};
	}, [open, close]);

	useEffect(() => {
		if (open)
			panelRef.current
				?.querySelector<HTMLElement>('[data-autofocus="true"]')
				?.focus();
	}, [open]);

	const update = (patch: Partial<ReaderSettings>) => {
		const next = { ...settings, ...patch };
		setStoredReaderSettings(next);
		applyReaderSettings(next);
		setSettings(next);
	};

	const reset = () => {
		const atDefault = sameSettings(settings, DEFAULT_READER_SETTINGS);
		setStoredReaderSettings(DEFAULT_READER_SETTINGS);
		applyReaderSettings(DEFAULT_READER_SETTINGS);
		setSettings(DEFAULT_READER_SETTINGS);
		setAnnounce(
			atDefault
				? "התאמות הנגישות כבר נמצאות בברירת המחדל"
				: "התאמות הנגישות אופסו לברירת המחדל",
		);
	};

	// Docking priority: next to the reader preferences gear where that gear
	// exists (reader unit pages); at the left-edge slot where neither it nor
	// the suppressed search button exists (e.g. /929/authors); otherwise
	// next to the search button.
	const nextToPrefs = hasReaderSettingsGear(pathname);
	const edgeDocked = !nextToPrefs && isReaderPathname(pathname);
	const dockClass = nextToPrefs
		? " top-nav-accessibility--after-prefs"
		: edgeDocked
			? " top-nav-accessibility--edge"
			: "";

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				className={`top-nav-accessibility${dockClass}`}
				aria-label="התאמות נגישות"
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-controls={open ? PANEL_ID : undefined}
				onClick={() => setOpen((v) => !v)}
			>
				<Image src="/icons/accessibility.svg" alt="" width={22} height={22} />
			</button>
			{open && (
				<div
					ref={panelRef}
					id={PANEL_ID}
					role="dialog"
					aria-label="התאמות נגישות"
					dir="rtl"
					className={styles.panel}
					data-testid="accessibility-menu"
				>
					<div className={styles.controls}>
						<label>
							גודל גופן
							<output>
								{Math.round(PEREK_FONT_SCALES[settings.fontStep] * 100)}%
							</output>
							<input
								aria-label="גודל גופן"
								type="range"
								min={0}
								max={PEREK_FONT_SCALES.length - 1}
								step={1}
								value={settings.fontStep}
								data-autofocus="true"
								onChange={(event) =>
									update({ fontStep: Number(event.target.value) })
								}
							/>
						</label>
						<label>
							ריווח אנכי
							<output>{settings.lineStep + 1}</output>
							<input
								aria-label="ריווח אנכי"
								type="range"
								min={0}
								max={PEREK_LINE_HEIGHTS.length - 1}
								step={1}
								value={settings.lineStep}
								onChange={(event) =>
									update({ lineStep: Number(event.target.value) })
								}
							/>
						</label>
						<label>
							ריווח אופקי
							<output>{settings.wordStep + 1}</output>
							<input
								aria-label="ריווח אופקי"
								type="range"
								min={0}
								max={PEREK_WORD_SPACINGS.length - 1}
								step={1}
								value={settings.wordStep}
								onChange={(event) =>
									update({ wordStep: Number(event.target.value) })
								}
							/>
						</label>
						<label>
							גופן פסוקים
							<select
								aria-label="גופן פסוקים"
								value={settings.fontId}
								onChange={(event) =>
									update({ fontId: Number(event.target.value) })
								}
							>
								{PEREK_TANAKH_FONTS.map((font, index) => (
									<option key={font || "default"} value={index}>
										{font === "noto" ? "Noto Serif Hebrew" : "Taamey D"}
									</option>
								))}
							</select>
						</label>
					</div>
					<button type="button" className={styles.reset} onClick={reset}>
						איפוס התאמות נגישות
					</button>
					<p role="status" className={styles.status}>
						{announce}
					</p>
					<Link href="/accessibility" className={styles.statement}>
						הצהרת נגישות
					</Link>
				</div>
			)}
		</>
	);
}
