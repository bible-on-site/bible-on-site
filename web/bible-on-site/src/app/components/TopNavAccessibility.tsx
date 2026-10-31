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
import {
	applySiteA11ySettings,
	DEFAULT_SITE_A11Y_SETTINGS,
	getStoredSiteA11ySettings,
	SITE_A11Y_EVENT,
	SITE_A11Y_STORAGE_KEY,
	type SiteA11ySettings,
	setStoredSiteA11ySettings,
} from "@/lib/site-a11y-settings";
import { hasReaderSettingsGear, isReaderPathname } from "./TopNavSearch";
import styles from "./top-nav-accessibility.module.css";

const PANEL_ID = "top-nav-accessibility-panel";

const sameSettings = (a: ReaderSettings, b: ReaderSettings) =>
	a.fontStep === b.fontStep &&
	a.lineStep === b.lineStep &&
	a.wordStep === b.wordStep &&
	a.fontId === b.fontId;

const sameA11y = (a: SiteA11ySettings, b: SiteA11ySettings) =>
	a.contrast === b.contrast && a.links === b.links;

/**
 * Accessibility adjustments menu in the shared top bar, next to the search
 * button — or next to the reader preferences gear on reader unit routes,
 * where the search button is intentionally absent. On reader-section routes
 * that suppress the search button but mount no gear (e.g. /929/authors) the
 * trigger takes the left-edge slot instead of docking beside a missing gear.
 * The controls reuse the perek reader display settings so they stay in sync
 * with the הגדרות קריאה dialog instead of competing with it. Site-wide
 * ניגודיות גבוהה and קו תחתון לקישורים persist in their own store
 * (site-a11y-settings.ts) — the reader-settings schema only owns scripture
 * display fields (#2767). The reset restores both the display adjustments
 * and the site toggles — unrelated preferences, recitation settings and
 * user data are untouched. The last item is the maintained הצהרת נגישות
 * link (issue #2396).
 */
export function TopNavAccessibility() {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const [settings, setSettings] = useState<ReaderSettings>(
		DEFAULT_READER_SETTINGS,
	);
	const [a11y, setA11y] = useState<SiteA11ySettings>(
		DEFAULT_SITE_A11Y_SETTINGS,
	);
	const [announce, setAnnounce] = useState("");
	const [lastPathname, setLastPathname] = useState(pathname);
	const [openedPathname, setOpenedPathname] = useState<string | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	// Route changes dismiss the popover (same convention as NavBar).
	if (pathname !== lastPathname) {
		setLastPathname(pathname);
		// A click can already belong to the browser's destination before
		// usePathname catches up. Preserve that opening on the same route.
		if (openedPathname !== pathname) setOpen(false);
		setAnnounce("");
	}

	const close = useCallback((restoreFocus = true) => {
		setOpen(false);
		if (restoreFocus) triggerRef.current?.focus();
	}, []);

	useEffect(() => {
		setSettings(getStoredReaderSettings());
		setA11y(getStoredSiteA11ySettings());
		const updated = (event: Event) =>
			setSettings((event as CustomEvent<ReaderSettings>).detail);
		const a11yUpdated = (event: Event) =>
			setA11y((event as CustomEvent<SiteA11ySettings>).detail);
		const stored = (event: StorageEvent) => {
			if (event.key === null || event.key === READER_SETTINGS_STORAGE_KEY)
				setSettings(getStoredReaderSettings());
			if (event.key === null || event.key === SITE_A11Y_STORAGE_KEY) {
				const next = getStoredSiteA11ySettings();
				setA11y(next);
				// Re-apply the palette/underline so a cross-tab change updates
				// this document too — the bootstrap only runs before paint.
				applySiteA11ySettings(next);
			}
		};
		window.addEventListener(READER_SETTINGS_EVENT, updated);
		window.addEventListener(SITE_A11Y_EVENT, a11yUpdated);
		window.addEventListener("storage", stored);
		return () => {
			window.removeEventListener(READER_SETTINGS_EVENT, updated);
			window.removeEventListener(SITE_A11Y_EVENT, a11yUpdated);
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

	const updateA11y = (patch: Partial<SiteA11ySettings>) => {
		const next = { ...a11y, ...patch };
		setStoredSiteA11ySettings(next);
		applySiteA11ySettings(next);
		setA11y(next);
	};

	const reset = () => {
		const atDefault =
			sameSettings(settings, DEFAULT_READER_SETTINGS) &&
			sameA11y(a11y, DEFAULT_SITE_A11Y_SETTINGS);
		setStoredReaderSettings(DEFAULT_READER_SETTINGS);
		applyReaderSettings(DEFAULT_READER_SETTINGS);
		setSettings(DEFAULT_READER_SETTINGS);
		setStoredSiteA11ySettings(DEFAULT_SITE_A11Y_SETTINGS);
		applySiteA11ySettings(DEFAULT_SITE_A11Y_SETTINGS);
		setA11y(DEFAULT_SITE_A11Y_SETTINGS);
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
				onClick={() => {
					setOpenedPathname(window.location.pathname);
					setOpen((v) => !v);
				}}
			>
				{/* Always visible at first paint — eager so the icon can never
				    arrive after paint and feed a layout-shift candidate. */}
				<Image
					src="/icons/accessibility.svg"
					alt=""
					width={22}
					height={22}
					loading="eager"
				/>
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
						<label className={styles.toggle}>
							ניגודיות גבוהה
							<input
								type="checkbox"
								checked={a11y.contrast}
								onChange={(event) =>
									updateA11y({ contrast: event.target.checked })
								}
							/>
						</label>
						<label className={styles.toggle}>
							קו תחתון לקישורים
							<input
								type="checkbox"
								checked={a11y.links}
								onChange={(event) =>
									updateA11y({ links: event.target.checked })
								}
							/>
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
