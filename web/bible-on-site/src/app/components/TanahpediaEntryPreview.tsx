"use client";

import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	computePreviewPosition,
	entityPreviewLink,
	entityPreviewPointerEnabled,
	previewSnippetChildren,
	previewUniqueNameFromHref,
} from "./tanahpedia-entry-preview";
import styles from "./tanahpedia-entry-preview.module.css";

interface PreviewData {
	title: string;
	snippet: string;
}

interface OpenPreview {
	anchor: HTMLAnchorElement;
	data: PreviewData;
}

const previewCache = new Map<string, PreviewData | null>();

async function fetchPreview(uniqueName: string): Promise<PreviewData | null> {
	if (previewCache.has(uniqueName)) return previewCache.get(uniqueName) ?? null;
	try {
		const res = await fetch(
			`/api/tanahpedia/preview/${encodeURIComponent(uniqueName)}`,
		);
		if (!res.ok) {
			previewCache.set(uniqueName, null);
			return null;
		}
		const data: PreviewData = await res.json();
		previewCache.set(uniqueName, data);
		return data;
	} catch (error) {
		console.warn("Tanahpedia preview fetch failed", { uniqueName, error });
		previewCache.set(uniqueName, null);
		return null;
	}
}

const TOOLTIP_ID = "tanahpedia-entry-preview";
// Grace period long enough for the pointer to cross the anchor-popover gap.
const HIDE_DELAY_MS = 200;

/**
 * Wikipedia-style entity preview (#3712): one document-level delegate for
 * every entity link - React-rendered `TanahpediaLink` anchors (marked
 * `data-tanahpedia-entry`) and pipeline-injected `a.tanahpedia-mention`
 * anchors inside stored commentary HTML. The preview opens on hover and on
 * keyboard focus, is anchored beside the link with no layout shift, and
 * dismisses on Escape, pointer leave or blur. On touch-primary devices the
 * whole delegate stays silent so a tap still navigates.
 */
export function TanahpediaEntryPreview() {
	const [open, setOpen] = useState<OpenPreview | null>(null);
	const [position, setPosition] = useState<{ x: number; y: number } | null>(
		null,
	);
	const popoverRef = useRef<HTMLDivElement>(null);
	const activeAnchor = useRef<HTMLAnchorElement | null>(null);
	// True while the pointer rests on the active anchor or inside the popover.
	const pointerInside = useRef(false);
	const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearHideTimer = useCallback(() => {
		if (hideTimer.current) {
			clearTimeout(hideTimer.current);
			hideTimer.current = null;
		}
	}, []);

	const close = useCallback(() => {
		activeAnchor.current = null;
		pointerInside.current = false;
		setOpen(null);
	}, []);

	const scheduleHide = useCallback(() => {
		clearHideTimer();
		hideTimer.current = setTimeout(() => {
			activeAnchor.current = null;
			setOpen(null);
		}, HIDE_DELAY_MS);
	}, [clearHideTimer]);

	// Re-anchor the mounted popover to its anchor's current rect.
	const place = useCallback((anchor: HTMLAnchorElement) => {
		const popover = popoverRef.current;
		if (!popover) return;
		const rect = anchor.getBoundingClientRect();
		setPosition(
			computePreviewPosition(
				rect,
				{ width: popover.offsetWidth, height: popover.offsetHeight },
				{ width: window.innerWidth, height: window.innerHeight },
			),
		);
	}, []);

	const show = useCallback(
		(anchor: HTMLAnchorElement) => {
			if (!entityPreviewPointerEnabled(window)) return;
			clearHideTimer();
			if (activeAnchor.current === anchor) return;
			activeAnchor.current = anchor;
			// Hover state belongs to the previous anchor; the pointer
			// handler re-marks it when the switch came from a pointer.
			pointerInside.current = false;
			setOpen(null);
			const uniqueName = previewUniqueNameFromHref(anchor.href);
			if (!uniqueName) {
				activeAnchor.current = null;
				return;
			}
			fetchPreview(uniqueName).then((data) => {
				if (data && activeAnchor.current === anchor) {
					setOpen({ anchor, data });
				}
			});
		},
		[clearHideTimer],
	);

	useEffect(() => {
		const insidePopover = (node: EventTarget | null) =>
			node instanceof Node && (popoverRef.current?.contains(node) ?? false);
		const stillFocused = () =>
			activeAnchor.current != null &&
			activeAnchor.current.ownerDocument.activeElement === activeAnchor.current;

		const onPointerOver = (e: MouseEvent) => {
			if (insidePopover(e.target)) {
				pointerInside.current = true;
				clearHideTimer();
				return;
			}
			const anchor = entityPreviewLink(e.target);
			if (!anchor) return;
			show(anchor);
			pointerInside.current = anchor === activeAnchor.current;
		};
		const onPointerOut = (e: MouseEvent) => {
			const to = e.relatedTarget;
			if (insidePopover(e.target)) {
				// Moving within the popover ignores; leaving it ends the hover.
				if (insidePopover(to)) return;
				pointerInside.current = false;
				if (!stillFocused()) scheduleHide();
				return;
			}
			const anchor = entityPreviewLink(e.target);
			if (!anchor || anchor !== activeAnchor.current) return;
			if (to instanceof Node && (anchor.contains(to) || insidePopover(to))) {
				return;
			}
			pointerInside.current = false;
			// A focused anchor keeps its preview after the pointer leaves.
			if (!stillFocused()) scheduleHide();
		};
		const onFocusIn = (e: FocusEvent) => {
			const anchor = entityPreviewLink(e.target);
			if (anchor) show(anchor);
		};
		const onFocusOut = (e: FocusEvent) => {
			const anchor = entityPreviewLink(e.target);
			if (!anchor || anchor !== activeAnchor.current) return;
			// A hovered anchor keeps its preview after losing focus.
			if (!pointerInside.current) scheduleHide();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && activeAnchor.current) close();
		};
		const onClick = (e: MouseEvent) => {
			if (entityPreviewLink(e.target)) close();
		};
		const onScrollOrResize = () => {
			const anchor = activeAnchor.current;
			// Scrolling may be the browser bringing a freshly focused anchor
			// into view: a focused preview re-anchors rather than closing.
			if (anchor && anchor.ownerDocument.activeElement === anchor) {
				place(anchor);
				return;
			}
			close();
		};

		document.addEventListener("mouseover", onPointerOver);
		document.addEventListener("mouseout", onPointerOut);
		document.addEventListener("focusin", onFocusIn);
		document.addEventListener("focusout", onFocusOut);
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("click", onClick);
		document.addEventListener("scroll", onScrollOrResize, true);
		window.addEventListener("resize", onScrollOrResize);
		return () => {
			document.removeEventListener("mouseover", onPointerOver);
			document.removeEventListener("mouseout", onPointerOut);
			document.removeEventListener("focusin", onFocusIn);
			document.removeEventListener("focusout", onFocusOut);
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("click", onClick);
			document.removeEventListener("scroll", onScrollOrResize, true);
			window.removeEventListener("resize", onScrollOrResize);
		};
	}, [show, scheduleHide, clearHideTimer, close, place]);

	useEffect(
		() => () => {
			if (hideTimer.current) clearTimeout(hideTimer.current);
		},
		[],
	);

	// Measure and place the popover in the layout phase so it never paints
	// unpositioned; the anchor keeps an aria-describedby for its duration.
	useLayoutEffect(() => {
		if (!open) return;
		open.anchor.setAttribute("aria-describedby", TOOLTIP_ID);
		place(open.anchor);
		return () => {
			open.anchor.removeAttribute("aria-describedby");
			setPosition(null);
		};
	}, [open, place]);

	if (!open) return null;
	return createPortal(
		<div
			ref={popoverRef}
			id={TOOLTIP_ID}
			role="tooltip"
			className={styles.popover}
			style={{
				left: position?.x ?? 0,
				top: position?.y ?? 0,
				visibility: position ? "visible" : "hidden",
			}}
		>
			<div className={styles.popoverTitle}>{open.data.title}</div>
			<div className={styles.popoverSnippet}>
				{previewSnippetChildren(open.data.snippet)}
			</div>
		</div>,
		document.body,
	);
}
