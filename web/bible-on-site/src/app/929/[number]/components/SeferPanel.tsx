"use client";

import { toLetters } from "gematry";
import DOMPurify from "isomorphic-dompurify";
import Image from "next/image";
import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ReadingProgress } from "@/app/components/ReadingProgress";
import { ReadingTime } from "@/app/components/ReadingTime";
import { Skeleton, SkeletonLabel } from "@/app/components/Skeleton";
import type { Article, ArticleSummary } from "@/lib/articles";
import { normalizeAbstractHtml } from "@/lib/authors/articles-grid";
import { demoteHeadings } from "@/lib/html-headings";
import type { PerushNote, PerushSummary } from "@/lib/perushim";
import type { ReadingProgressUnit } from "@/lib/reading-metrics/types";
import {
	resolveSeferPerushSelection,
	SEFER_PERUSH_SELECTION_EVENT,
	setSeferPerushSelection,
} from "@/lib/sefer-perush-selection";
import {
	getArticleForBook,
	getArticleProgressUnitsForBook,
	getNoteProgressUnitsForPerekBatch,
	getPerushNotesForPerekBatch,
} from "../actions";
import { ArticleFullView } from "./ArticleFullView";
import { ShareButton } from "./ShareButton";
import {
	articleDocumentTitle,
	perushDocumentTitle,
	type SeferPerekTitle,
} from "./sefer-document-title";
import styles from "./sefer-panel.module.css";
import {
	scrollToSeferPasuk,
	setSeferOpenPerush,
} from "./sefer-pasuk-navigation";
import {
	clearSeferPasukSelection,
	setSeferPasukSelectionMode,
	useSeferPasukSelection,
	useSeferPasukSelectionMode,
} from "./sefer-pasuk-selection";
import { writeSeferContentHistory } from "./useSeferContentNavigation";

type PanelTab = "perushim" | "articles";

/** Stable empty list — the effect reset must reuse one reference or a
 * new `[]` identity re-triggers the render loop (#2731). */
const NO_LINES: string[] = [];
const COMMENTARY_SKELETON_KEYS = ["a", "b", "c"];

interface SeferPanelProps {
	/** Only the displayed chapter may start commentary reads. */
	isActive?: boolean;
	articles?: ArticleSummary[];
	perushim?: PerushSummary[];
	perekId?: number;
	/** Sefer name scoping the perush-selection override (#2544). */
	seferName?: string;
	hebrewDateStr: string;
	/** Article ID or perush name selected by the current book route. */
	initialSlug?: string;
	/** Dynamically expand a perush (by name) or article (by numeric id string) — set by QA navigation */
	expandSlug?: string;
	/** Change token to re-trigger expansion even with the same slug */
	expandToken?: number;
	/** Target note pasuk for scrolling after perush expansion */
	expandNotePasuk?: number;
	/** Target note index for scrolling after perush expansion */
	expandNoteIdx?: number;
	onNavigate?: (slug?: string) => void;
	/** Title parts of this page's perek, for the perush document title. */
	perekTitleParts?: SeferPerekTitle;
	/** Reports the shown article/perush document title (null when none). */
	onContentTitle?: (title: string | null) => void;
	/** Selected pesukim on the scripture page; empty/null = whole perek.
	 *  When omitted, the panel subscribes to the book's pasuk-selection
	 *  store (sefer-pasuk-selection). */
	selectedPesukim?: ReadonlySet<number> | null;
}

const NO_ARTICLES: ArticleSummary[] = [];
const NO_PERUSHIM: PerushSummary[] = [];

const PANEL_TAB_STORAGE_KEY = "seferPanelTab";

function readStoredTab(): PanelTab | null {
	/* istanbul ignore next: SSR */
	if (typeof window === "undefined") return null;
	try {
		const raw = sessionStorage.getItem(PANEL_TAB_STORAGE_KEY);
		return raw === "articles" || raw === "perushim" ? raw : null;
	} catch {
		return null;
	}
}

function writeStoredTab(tab: PanelTab): void {
	try {
		sessionStorage.setItem(PANEL_TAB_STORAGE_KEY, tab);
	} catch {
		/* convenience only */
	}
}

function subscribeSelection(listener: () => void): () => void {
	window.addEventListener(SEFER_PERUSH_SELECTION_EVENT, listener);
	window.addEventListener("storage", listener);
	return () => {
		window.removeEventListener(SEFER_PERUSH_SELECTION_EVENT, listener);
		window.removeEventListener("storage", listener);
	};
}

interface PerushNotes {
	[perushId: number]: PerushNote[];
}

interface PasukGroup {
	pasuk: number;
	perushim: { perush: PerushSummary; notes: PerushNote[] }[];
}

/**
 * The Sefer blank page (#2544): a tabbed panel replacing the commentary and
 * article carousels — פרשנים on one side of the date, מאמרים on the other.
 * פרשנים holds a multi-select tag list (Tanach-wide default with per-sefer
 * override) above the commentary grouped by pasuk; מאמרים holds a masonry
 * grid that keeps its place while an article opens over it.
 */
export const SeferPanel = memo(function SeferPanel({
	isActive = true,
	articles = NO_ARTICLES,
	perushim = NO_PERUSHIM,
	perekId = 0,
	seferName = "",
	hebrewDateStr,
	initialSlug,
	expandSlug,
	expandToken,
	expandNotePasuk,
	expandNoteIdx,
	onNavigate,
	perekTitleParts,
	onContentTitle,
	selectedPesukim,
}: SeferPanelProps) {
	// Eligible perushim: commentary on at least one pasuk of this perek.
	const eligible = perushim.filter((perush) => perush.noteCount >= 1);

	/* ─── Pasuk selection on the facing scripture page (#2544 item 3) ─── */
	const storePesukim = useSeferPasukSelection(perekId);
	const pasukSelectionMode = useSeferPasukSelectionMode(perekId);
	const pasukSource =
		selectedPesukim !== undefined ? selectedPesukim : storePesukim;
	// No explicit pasuk selection = the whole perek (issue #2544).
	const activePesukim =
		pasukSource && pasukSource.size > 0 ? pasukSource : null;

	const [slug, setSlug] = useState(initialSlug);
	useEffect(() => setSlug(initialSlug), [initialSlug]);

	const deepPerush = slug
		? eligible.find((perush) => perush.name === slug)
		: undefined;
	const deepArticleSummary =
		slug && !deepPerush
			? articles.find((item) => String(item.id) === slug)
			: undefined;

	/* ─── Active tab ─── */
	const [activeTab, setActiveTab] = useState<PanelTab>(
		() =>
			(deepPerush ? "perushim" : deepArticleSummary ? "articles" : null) ??
			readStoredTab() ??
			"perushim",
	);
	useEffect(() => writeStoredTab(activeTab), [activeTab]);
	// A deep link forces its own tab.
	useEffect(() => {
		if (deepPerush) setActiveTab("perushim");
		else if (deepArticleSummary) setActiveTab("articles");
	}, [deepPerush, deepArticleSummary]);

	const tabFor = useCallback((tab: PanelTab) => () => setActiveTab(tab), []);
	// RTL tab order: ArrowRight moves to the visually-right tab (perushim).
	const onTabListKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			const order: PanelTab[] = ["perushim", "articles"];
			const index = order.indexOf(activeTab);
			let next: number | null = null;
			if (event.key === "ArrowRight") next = Math.max(index - 1, 0);
			else if (event.key === "ArrowLeft")
				next = Math.min(index + 1, order.length - 1);
			else if (event.key === "Home") next = 0;
			else if (event.key === "End") next = order.length - 1;
			if (next == null || next === index) return;
			event.preventDefault();
			const tab = order[next];
			setActiveTab(tab);
			document.getElementById(`sefer-tab-${tab}-${perekId}`)?.focus();
		},
		[activeTab, perekId],
	);

	/* ─── Article full view (unchanged contract) ─── */
	const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
	const [articleDedicationLines, setArticleDedicationLines] =
		useState(NO_LINES);
	const [articleLoading, setArticleLoading] = useState(false);
	const [articleFullscreen, setArticleFullscreen] = useState(false);
	const [articleProgressUnits, setArticleProgressUnits] = useState<
		ReadingProgressUnit[]
	>([]);

	useEffect(() => {
		let cancelled = false;
		setSelectedArticle(null);
		setArticleProgressUnits([]);
		setArticleDedicationLines(NO_LINES);
		setArticleLoading(false);
		setArticleFullscreen(false);
		if (deepArticleSummary) {
			setArticleLoading(true);
			getArticleForBook(deepArticleSummary.id)
				.then((full) => {
					if (!cancelled) {
						setSelectedArticle(full?.article ?? null);
						setArticleDedicationLines(full?.dedicationLines ?? NO_LINES);
						if (!full) setSlug(undefined);
					}
				})
				.catch((error) => {
					console.error("Failed to load book article", {
						perekId,
						articleId: deepArticleSummary.id,
						error,
					});
					if (!cancelled) setSlug(undefined);
				})
				.finally(() => {
					if (!cancelled) setArticleLoading(false);
				});
			getArticleProgressUnitsForBook(deepArticleSummary.id)
				.then((progressUnits) => {
					if (!cancelled) setArticleProgressUnits(progressUnits);
				})
				.catch((error) => {
					console.warn("Failed to load article reading progress", {
						articleId: deepArticleSummary.id,
						error,
					});
				});
		}
		return () => {
			cancelled = true;
		};
	}, [deepArticleSummary, perekId]);

	/* ─── Article fullscreen modal + return-to-grid focus (#2786) ─── */
	const rootRef = useRef<HTMLElement>(null);
	// Set by an explicit חזרה למאמרים click — the article card that should
	// receive focus once the overlay unmounts.
	const pendingArticleFocus = useRef<number | null>(null);
	const wasArticleFullscreen = useRef(false);
	// The dialog body's reading position, snapshotted before React detaches
	// the portal — by the time the modal effect's exit path runs the dialog
	// is already unmounted and its scrollTop reads 0.
	const closingScrollTop = useRef<number | null>(null);

	// Every fullscreen-exit path (exit command, Escape) goes through here so
	// the reading position is captured while the dialog still lives.
	const closeArticleFullscreen = useCallback(() => {
		const body = document
			.querySelector<HTMLElement>("[data-article-dialog]")
			?.querySelector<HTMLElement>("[data-article-body]");
		closingScrollTop.current = body ? body.scrollTop : null;
		setArticleFullscreen(false);
	}, []);

	// Escape exits the article fullscreen (browser fullscreen stays the
	// book's own concern — this overlay is the article's, #2544 item 7).
	useEffect(() => {
		if (!articleFullscreen) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") closeArticleFullscreen();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [articleFullscreen, closeArticleFullscreen]);

	// Escape raised inside the dialog stops at this topmost surface; the
	// document listener above stays the fallback for focus outside it.
	const onArticleDialogKeyDown = (
		event: React.KeyboardEvent<HTMLDivElement>,
	) => {
		if (event.key === "Escape") {
			event.stopPropagation();
			closeArticleFullscreen();
		}
	};

	// The article fullscreen is a modal dialog: aria-modal alone does not
	// keep Tab inside, so every body sibling of the portal goes inert (the
	// panel's own inert covers the embedded twin). Focus enters on the exit
	// control and returns to the embedded twin on exit. The reading position
	// follows the reader: mirrored into the fullscreen body on open and
	// written back to the embedded body on exit.
	useEffect(() => {
		const wasFullscreen = wasArticleFullscreen.current;
		wasArticleFullscreen.current = articleFullscreen;
		if (articleFullscreen === wasFullscreen) return;
		if (articleFullscreen) {
			const dialog = document.querySelector<HTMLElement>(
				"[data-article-dialog]",
			);
			/* istanbul ignore if -- the portal mounts in the same commit */
			if (!dialog) return;
			const inerted: Element[] = [];
			for (const sibling of document.body.children) {
				if (sibling === dialog || sibling.hasAttribute("inert")) continue;
				sibling.setAttribute("inert", "");
				inerted.push(sibling);
			}
			(
				dialog.querySelector<HTMLElement>(
					"[data-article-action='fullscreen']",
				) ?? dialog
			).focus();
			const embeddedBody = rootRef.current?.querySelector<HTMLElement>(
				"[data-article-body]",
			);
			const fullscreenBody = dialog.querySelector<HTMLElement>(
				"[data-article-body]",
			);
			if (embeddedBody && fullscreenBody) {
				fullscreenBody.scrollTop = embeddedBody.scrollTop;
			}
			const previousOverflow = document.body.style.overflow;
			document.body.style.overflow = "hidden";
			return () => {
				for (const el of inerted) el.removeAttribute("inert");
				document.body.style.overflow = previousOverflow;
			};
		}
		if (pendingArticleFocus.current == null) {
			rootRef.current
				?.querySelector<HTMLElement>("[data-article-action='fullscreen']")
				?.focus({ preventScroll: true });
		}
		const embeddedBody = rootRef.current?.querySelector<HTMLElement>(
			"[data-article-body]",
		);
		if (embeddedBody && closingScrollTop.current != null) {
			embeddedBody.scrollTop = closingScrollTop.current;
		}
		closingScrollTop.current = null;
	}, [articleFullscreen]);

	// After an explicit return to the grid, hand focus to the article's card —
	// the masonry never unmounted, so its DOM order and scroll are intact.
	// preventScroll keeps that restored scroll position: the card may sit
	// just outside the viewport and a scroll-into-view would move the grid.
	useEffect(() => {
		if (selectedArticle || pendingArticleFocus.current == null) return;
		const card = document.getElementById(
			`article-${pendingArticleFocus.current}`,
		);
		pendingArticleFocus.current = null;
		card?.focus({ preventScroll: true });
	}, [selectedArticle]);

	/* ─── Perush selection (global default / sefer override) ─── */
	// Read directly (the panel lives in the client-only flipbook) and re-read
	// on the module's change event — resolveSeferPerushSelection returns a
	// fresh object each call, so useSyncExternalStore would loop on it.
	const [selection, setSelection] = useState(() =>
		resolveSeferPerushSelection(seferName),
	);
	useEffect(() => {
		const read = () => setSelection(resolveSeferPerushSelection(seferName));
		read();
		return subscribeSelection(read);
	}, [seferName]);

	const effectiveIds = deepPerush ? [deepPerush.id] : selection.ids;
	const selectedIds = new Set(effectiveIds);
	// Only eligible perushim render as selected; stored ids unavailable on
	// this perek stay stored and simply have no tag here.
	const renderedSelection = new Set(
		effectiveIds.filter((id) => eligible.some((p) => p.id === id)),
	);

	const togglePerush = useCallback(
		(perushId: number) => {
			const next = new Set(selection.ids);
			if (next.has(perushId)) next.delete(perushId);
			else next.add(perushId);
			setSeferPerushSelection(seferName, [...next]);
		},
		[selection.ids, seferName],
	);

	/* ─── Commentary notes (batched per perek) ─── */
	const [notesByPerush, setNotesByPerush] = useState<PerushNotes>({});
	const [noteUnitsByPerush, setNoteUnitsByPerush] = useState<
		Record<number, ReadingProgressUnit[]>
	>({});
	const [failedIds, setFailedIds] = useState<ReadonlySet<number>>(new Set());
	const requestedIds = useRef(new Set<number>());
	const notesGeneration = useRef({ perekId });
	useEffect(() => {
		notesGeneration.current = { perekId };
		requestedIds.current = new Set();
		setNotesByPerush({});
		setNoteUnitsByPerush({});
		setFailedIds(new Set());
		return () => {
			notesGeneration.current = { perekId };
		};
	}, [perekId]);

	const wantedIds = eligible
		.filter((perush) => selectedIds.has(perush.id))
		.map((perush) => perush.id)
		.sort((a, b) => a - b)
		.join(",");
	useEffect(() => {
		// Neighboring buffered pages share the selection, but their reads must
		// not queue ahead of the chapter the reader is actually viewing.
		if (!isActive) return;
		const missing = wantedIds
			.split(",")
			.filter(Boolean)
			.map(Number)
			.filter(
				(id) =>
					notesByPerush[id] == null &&
					!failedIds.has(id) &&
					!requestedIds.current.has(id),
			);
		if (missing.length === 0) return;
		for (const id of missing) requestedIds.current.add(id);
		// Selection changes must not discard an outstanding batch. Each result
		// still belongs to this chapter, even if another batch finishes first.
		const generation = notesGeneration.current;
		getPerushNotesForPerekBatch(perekId, missing)
			.then((batch) => {
				if (generation !== notesGeneration.current) return;
				setNotesByPerush((prev) => {
					const next = { ...prev };
					for (const id of missing) next[id] = batch[id] ?? [];
					return next;
				});
			})
			.catch((error) => {
				if (generation !== notesGeneration.current) return;
				console.error("Failed to load book commentary", {
					perekId,
					perushIds: missing,
					error,
				});
				setFailedIds((prev) => new Set([...prev, ...missing]));
				for (const id of missing) requestedIds.current.delete(id);
			});
		getNoteProgressUnitsForPerekBatch(perekId, missing)
			.then((batch) => {
				if (generation !== notesGeneration.current) return;
				setNoteUnitsByPerush((prev) => {
					const next = { ...prev };
					for (const id of missing) next[id] = batch[id] ?? [];
					return next;
				});
			})
			.catch((error) => {
				if (generation !== notesGeneration.current) return;
				console.warn("Failed to load commentary reading progress", {
					perekId,
					perushIds: missing,
					error,
				});
			});
	}, [isActive, wantedIds, notesByPerush, failedIds, perekId]);

	const retryPerush = useCallback((perushId: number) => {
		setFailedIds((prev) => {
			const next = new Set(prev);
			next.delete(perushId);
			return next;
		});
	}, []);

	/* ─── Grouped commentary by pasuk, canonical order ─── */
	const displayPerushim = deepPerush
		? [deepPerush]
		: eligible.filter((perush) => renderedSelection.has(perush.id));

	const groups: PasukGroup[] = (() => {
		const byPasuk = new Map<number, PasukGroup["perushim"]>();
		for (const perush of displayPerushim) {
			for (const note of notesByPerush[perush.id] ?? []) {
				if (activePesukim && !activePesukim.has(note.pasuk)) continue;
				const entries = byPasuk.get(note.pasuk) ?? [];
				let entry = entries.find((item) => item.perush.id === perush.id);
				if (!entry) {
					entry = { perush, notes: [] };
					entries.push(entry);
				}
				entry.notes.push(note);
				byPasuk.set(note.pasuk, entries);
			}
		}
		return [...byPasuk.entries()]
			.sort(([a], [b]) => a - b)
			.map(([pasuk, perushim]) => ({ pasuk, perushim }));
	})();

	/**
	 * Stored note units for the commentary pane's reading progress (#2607),
	 * keyed `perushId:pasuk:noteIdx` to match the `data-reading-unit`
	 * attributes below. Only notes actually rendered contribute — a pasuk
	 * selection or a still-loading perush must not inflate progress.
	 */
	const commentaryProgressUnits = (() => {
		const rendered = new Set<string>();
		for (const group of groups) {
			for (const { perush, notes } of group.perushim) {
				for (const note of notes) {
					rendered.add(`${perush.id}:${note.pasuk}:${note.noteIdx}`);
				}
			}
		}
		return displayPerushim.flatMap((perush) =>
			(noteUnitsByPerush[perush.id] ?? [])
				.map((unit) => ({ ...unit, key: `${perush.id}:${unit.key}` }))
				.filter((unit) => rendered.has(unit.key ?? "")),
		);
	})();

	const loadingNotes = wantedIds
		.split(",")
		.filter(Boolean)
		.some(
			(id) => notesByPerush[Number(id)] == null && !failedIds.has(Number(id)),
		);
	const hasFailures = displayPerushim.some((p) => failedIds.has(p.id));

	/* ─── Publish commentary pesukim for pasuk-letter navigation ─── */
	const groupsPesukim = groups.map((group) => group.pasuk).join(",");
	useEffect(() => {
		if (!perekId) return;
		const pesukim =
			activeTab === "perushim" && groupsPesukim
				? new Set(groupsPesukim.split(",").map(Number))
				: null;
		setSeferOpenPerush(
			perekId,
			pesukim ? { name: deepPerush?.name ?? "פרשנים", pesukim } : null,
		);
		return () => setSeferOpenPerush(perekId, null);
	}, [perekId, activeTab, groupsPesukim, deepPerush]);

	/* ─── Document title (issue #2176 contract, unchanged) ─── */
	useEffect(() => {
		if (!onContentTitle) return;
		const title = selectedArticle
			? articleDocumentTitle(selectedArticle)
			: deepPerush && perekTitleParts
				? perushDocumentTitle(deepPerush, perekTitleParts)
				: null;
		onContentTitle(title);
		return () => onContentTitle(null);
	}, [selectedArticle, deepPerush, onContentTitle, perekTitleParts]);

	const navigate = useCallback(
		(nextSlug?: string) => {
			if (onNavigate) onNavigate(nextSlug);
			else if (perekId) writeSeferContentHistory(perekId, nextSlug);
			setSlug(nextSlug);
		},
		[onNavigate, perekId],
	);

	// Dynamically expand a perush or article when QA navigation sets expandSlug
	const lastExpandToken = useRef<number>(0);
	const pendingScrollNote = useRef<string | null>(null);

	useEffect(() => {
		if (
			!expandSlug ||
			expandToken == null ||
			expandToken === lastExpandToken.current
		)
			return;
		lastExpandToken.current = expandToken;

		// Compute the scroll target id before triggering expansion
		pendingScrollNote.current =
			expandNotePasuk != null && expandNoteIdx != null
				? `book-note-${toLetters(expandNotePasuk)}-${expandNoteIdx + 1}`
				: null;

		navigate(expandSlug);
	}, [expandSlug, expandToken, expandNotePasuk, expandNoteIdx, navigate]);

	// After a perush expands, scroll to the target note if one is pending
	useEffect(() => {
		if (!deepPerush || !pendingScrollNote.current) return;
		const noteId = pendingScrollNote.current;
		pendingScrollNote.current = null;
		requestAnimationFrame(() => {
			const el = document.getElementById(noteId);
			el?.scrollIntoView({ behavior: "smooth", block: "center" });
		});
	}, [deepPerush]);
	// חזרה למאמרים always lands on the articles grid — from the embedded view
	// and from article fullscreen alike (#2786). The card it came from gets
	// focus once the overlay clears.
	const returnToArticles = useCallback(() => {
		pendingArticleFocus.current = selectedArticle?.id ?? null;
		setArticleFullscreen(false);
		navigate();
	}, [selectedArticle?.id, navigate]);

	const tabId = (tab: PanelTab) => `sefer-tab-${tab}-${perekId}`;
	const panelId = (tab: PanelTab) => `sefer-panel-${tab}-${perekId}`;

	return (
		<section
			ref={rootRef}
			className={`${styles.panelRoot} flipbook-page-bounded`}
			aria-label="פירושים ומאמרים"
			inert={articleFullscreen}
		>
			{/* tablist header: פרשנים - date - מאמרים (RTL order) */}
			<div
				className={styles.panelHeader}
				role="tablist"
				aria-label="בחירת תצוגה"
				onKeyDown={onTabListKeyDown}
			>
				<button
					type="button"
					role="tab"
					id={tabId("perushim")}
					aria-selected={activeTab === "perushim"}
					aria-controls={panelId("perushim")}
					tabIndex={activeTab === "perushim" ? 0 : -1}
					className={styles.panelTab}
					onClick={tabFor("perushim")}
				>
					פרשנים
				</button>
				<div className={styles.panelDate} role="presentation">
					{hebrewDateStr}
				</div>
				<button
					type="button"
					role="tab"
					id={tabId("articles")}
					aria-selected={activeTab === "articles"}
					aria-controls={panelId("articles")}
					tabIndex={activeTab === "articles" ? 0 : -1}
					className={styles.panelTab}
					onClick={tabFor("articles")}
				>
					מאמרים
				</button>
			</div>

			<div className={styles.panelStage}>
				{/* ─── פרשנים ─── */}
				<div
					role="tabpanel"
					id={panelId("perushim")}
					aria-labelledby={tabId("perushim")}
					data-tab="perushim"
					data-active={activeTab === "perushim"}
					className={styles.panel}
					data-sefer-perush-perek={perekId || undefined}
					data-sefer-perush={
						deepPerush?.name ??
						displayPerushim.map((perush) => perush.name).join(",")
					}
					inert={activeTab !== "perushim"}
				>
					{deepPerush ? (
						<div className={styles.deepHeader}>
							<button
								type="button"
								className={styles.deepBack}
								onClick={() => navigate()}
							>
								→ חזרה לפרשנים
							</button>
							<div className={styles.deepTitle}>
								<h2 className={styles.deepName}>{deepPerush.name}</h2>
								<span className={styles.deepParshan}>
									{deepPerush.parshanName}
								</span>
								<ReadingTime
									estimatedSeconds={deepPerush.metric?.estimatedSeconds}
									className={styles.deepMetric}
								/>
							</div>
							{perekId > 0 && (
								<ShareButton
									canonicalPath={`/929/${perekId}/${encodeURIComponent(deepPerush.name)}`}
									title={`${deepPerush.name} - ${deepPerush.parshanName}`}
								/>
							)}
						</div>
					) : (
						<div className={styles.tagArea} data-flipbook-no-flip>
							<ul className={styles.tagList} aria-label="בחירת פרשנים">
								{eligible.map((perush) => (
									<li
										key={perush.id}
										className={styles.perushTagItem}
										data-selected={
											renderedSelection.has(perush.id) || undefined
										}
									>
										<button
											type="button"
											className={styles.perushTag}
											aria-pressed={renderedSelection.has(perush.id)}
											aria-label={`בחירת ${perush.name}`}
											title={perush.parshanName}
											onClick={() => togglePerush(perush.id)}
										>
											<span>{perush.name}</span>
										</button>
									</li>
								))}
							</ul>
							{perekId > 0 && (
								<div className={styles.scopeRow}>
									<span>
										{activePesukim
											? `מסוננים: ${activePesukim.size} פסוקים`
											: pasukSelectionMode
												? "סמנו פסוקים על גבי הפרק"
												: "כל פסוקי הפרק"}
									</span>
									{displayPerushim.length === 1 && (
										<ReadingTime
											estimatedSeconds={
												displayPerushim[0].metric?.estimatedSeconds
											}
											className={styles.scopeMetric}
										/>
									)}
									{activePesukim && (
										<button
											type="button"
											className={styles.scopeToggle}
											onClick={() => clearSeferPasukSelection(perekId)}
										>
											ניקוי בחירה
										</button>
									)}
									<button
										type="button"
										className={styles.scopeToggle}
										aria-pressed={pasukSelectionMode}
										onClick={() =>
											setSeferPasukSelectionMode(perekId, !pasukSelectionMode)
										}
									>
										{pasukSelectionMode ? "סיום בחירה" : "בחירת פסוקים"}
									</button>
								</div>
							)}
						</div>
					)}

					<div className={styles.commentaryScroll} data-flipbook-no-flip>
						<ReadingProgress
							units={commentaryProgressUnits}
							scroller={`.${styles.commentaryScroll}`}
							content={`.${styles.commentaryScroll}`}
							unitSelector='[data-reading-unit="{key}"]'
						/>
						{eligible.length === 0 ? (
							<p className={styles.emptyState}>אין פרשנות לפרק זה</p>
						) : displayPerushim.length === 0 && !deepPerush ? (
							<p className={styles.emptyState}>
								לא נבחרו פרשנים. בחרו פרשן מהרשימה כדי לראות פירוש.
							</p>
						) : loadingNotes ? (
							<div aria-busy="true">
								<SkeletonLabel>מתחבר לפירוש...</SkeletonLabel>
								{COMMENTARY_SKELETON_KEYS.map((key) => (
									<div key={key} className={styles.commentaryGroup}>
										<Skeleton
											width="4.5em"
											height="0.85rem"
											className={styles.skeletonPasuk}
										/>
										<div className={styles.noteContent}>
											<Skeleton className={styles.skeletonLine} />
											<Skeleton className={styles.skeletonLine} />
											<Skeleton width="60%" className={styles.skeletonLine} />
										</div>
									</div>
								))}
							</div>
						) : groups.length === 0 && !hasFailures ? (
							<p className={styles.emptyState}>
								{activePesukim
									? "אין פרשנות מן הפרשנים שנבחרו לפסוקים שנבחרו"
									: "אין פרשנות זמינה כעת"}
							</p>
						) : (
							groups.map((group) => (
								<div
									key={group.pasuk}
									className={styles.commentaryGroup}
									data-perush-pasuk={group.pasuk}
								>
									{perekId > 0 ? (
										<button
											type="button"
											className={styles.commentaryPasuk}
											data-flipbook-no-flip
											title={`מעבר לפסוק ${toLetters(group.pasuk)} בפרק`}
											aria-label={`מעבר לפסוק ${toLetters(group.pasuk)} בפרק`}
											onClick={() => scrollToSeferPasuk(perekId, group.pasuk)}
										>
											פסוק {toLetters(group.pasuk)}
										</button>
									) : (
										<div className={styles.commentaryPasuk}>
											פסוק {toLetters(group.pasuk)}
										</div>
									)}
									{group.perushim.map(({ perush, notes }) => (
										<div key={perush.id} className={styles.commentaryPerush}>
											{displayPerushim.length > 1 && (
												<div className={styles.commentaryPerushName}>
													{perush.name}
													<ReadingTime
														estimatedSeconds={perush.metric?.estimatedSeconds}
														className={styles.commentaryPerushMetric}
													/>
												</div>
											)}
											{/* Codacy anchors the XSS finding at this map
											 * expression, so the nosemgrep suppression must
											 * sit here rather than beside the attribute. */}
											{/* nosemgrep -- DOMPurify-sanitized note HTML */}
											{notes.map((note) => (
												<div
													key={`${note.pasuk}-${note.noteIdx}`}
													id={`book-note-${toLetters(note.pasuk)}-${note.noteIdx + 1}`}
													className={styles.noteContent}
													data-reading-unit={`${perush.id}:${note.pasuk}:${note.noteIdx}`}
													// nosemgrep -- DOMPurify-sanitized note HTML
													// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
													dangerouslySetInnerHTML={{
														__html: DOMPurify.sanitize(
															demoteHeadings(note.noteContent),
														),
													}}
												/>
											))}
										</div>
									))}
								</div>
							))
						)}
						{displayPerushim
							.filter((perush) => failedIds.has(perush.id))
							.map((perush) => (
								<p key={perush.id} className={styles.noteError}>
									טעינת הפירוש {perush.name} נכשלה.
									<button
										type="button"
										className={styles.noteRetry}
										onClick={() => retryPerush(perush.id)}
									>
										נסו שוב
									</button>
								</p>
							))}
					</div>
				</div>

				{/* ─── מאמרים ─── */}
				<div
					role="tabpanel"
					id={panelId("articles")}
					aria-labelledby={tabId("articles")}
					data-tab="articles"
					data-active={activeTab === "articles"}
					className={styles.panel}
					inert={activeTab !== "articles"}
				>
					<div
						className={styles.articlesScroll}
						aria-busy={articleLoading}
						data-flipbook-no-flip
					>
						{articles.length === 0 ? (
							<p className={styles.emptyState}>אין מאמרים לפרק זה</p>
						) : (
							<div className={styles.articlesMasonry}>
								{articles.map((article) => (
									<Link
										key={article.id}
										id={`article-${article.id}`}
										href={`/929/${article.perekId}/${article.id}`}
										prefetch={false}
										className={styles.articleCard}
										onClick={(event) => {
											if (
												event.metaKey ||
												event.ctrlKey ||
												event.shiftKey ||
												event.altKey
											) {
												return;
											}
											event.preventDefault();
											navigate(String(article.id));
										}}
									>
										<div className={styles.articleCardAuthor}>
											<Image
												src={article.authorImageUrl}
												alt=""
												aria-hidden="true"
												width={28}
												height={28}
												className={styles.articleCardImg}
											/>
											<span className={styles.articleCardAuthorName}>
												{article.authorName}
											</span>
										</div>
										<div className={styles.articleCardTitle}>
											{article.name}
										</div>
										{/* Codacy anchors the XSS finding at this
										 * conditional expression, so the nosemgrep
										 * suppression must sit here rather than beside
										 * the attribute. */}
										{/* nosemgrep -- DOMPurify-sanitized abstract */}
										{article.abstract && (
											<div
												className={styles.articleCardAbstract}
												// nosemgrep -- DOMPurify-sanitized abstract
												// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
												dangerouslySetInnerHTML={{
													__html: DOMPurify.sanitize(
														normalizeAbstractHtml(article.abstract),
													),
												}}
											/>
										)}
										<ReadingTime
											estimatedSeconds={article.metric?.estimatedSeconds}
											className={styles.articleCardMetric}
										/>
									</Link>
								))}
							</div>
						)}
					</div>

					{selectedArticle && (
						<div
							className={styles.panelArticleOverlay}
							data-flipbook-no-flip
						>
							<ArticleFullView
								article={selectedArticle}
								dedicationLines={articleDedicationLines}
								onBack={returnToArticles}
								fullPage
								fullscreen={articleFullscreen}
								onToggleFullscreen={() => setArticleFullscreen((prev) => !prev)}
								progressUnits={articleProgressUnits}
							/>
						</div>
					)}
				</div>
			</div>

			{articleFullscreen &&
				selectedArticle &&
				createPortal(
					<div
						className={styles.articleFullscreen}
						role="dialog"
						aria-modal="true"
						aria-label={selectedArticle.name}
						data-article-dialog
						tabIndex={-1}
						onKeyDown={onArticleDialogKeyDown}
					>
						<div className={styles.articleFullscreenBody}>
							<ArticleFullView
								article={selectedArticle}
								dedicationLines={articleDedicationLines}
								onBack={returnToArticles}
								fullPage
								fullscreen
								onToggleFullscreen={closeArticleFullscreen}
								progressUnits={articleProgressUnits}
							/>
						</div>
					</div>,
					document.body,
				)}
		</section>
	);
});
