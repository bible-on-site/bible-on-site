"use client";

import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import styles from "./carousel.module.css";

interface CarouselProps {
	/** Class of the scroll container (layout, gap, scroll-snap). */
	className: string;
	prevLabel: string;
	nextLabel: string;
	/**
	 * Key under which the position is kept while the items are unavailable —
	 * a loading placeholder or an unmounted carousel — so the same key's next
	 * render picks up where the user left off. The position lives for the
	 * browser session only; callers should scope keys to the page or unit
	 * being read.
	 */
	scrollStorageKey?: string;
	children: ReactNode;
}

interface CarouselState {
	overflows: boolean;
	canPrev: boolean;
	canNext: boolean;
	first: number;
	last: number;
	total: number;
}

/**
 * A position robust enough to survive the carousel's items disappearing —
 * a loading placeholder or an unmount while a perush is open — and coming
 * back with different card or viewport widths.
 */
interface CarouselPosition {
	/** Index of the first item visible at the scroller's start edge. */
	itemIndex: number;
	/** Distance of that item's start edge from the viewport's start edge. */
	itemGap: number;
}

const TOLERANCE_PX = 2;

const INITIAL_STATE: CarouselState = {
	overflows: false,
	canPrev: false,
	canNext: false,
	first: 0,
	last: 0,
	total: 0,
};

/**
 * Per-child layout that scroll does not change: scrolling moves the
 * viewport, never the children. Rebuilt on renders whose children differ
 * and on resizes; scroll events only re-derive against it.
 */
interface Geometry {
	rtl: boolean;
	/** The children at measure time, for identity checks on later renders. */
	items: Element[];
	/** Distance of each child's start edge from the content's start edge. */
	offsets: number[];
	/** Each child's inline size. */
	widths: number[];
	scrollWidth: number;
	clientWidth: number;
}

interface Measurement extends CarouselState {
	rtl: boolean;
	offsets: number[];
	/** First item whose start edge has not passed the viewport's start edge. */
	anchorIndex: number;
	/** That item's distance from the viewport's start edge. */
	anchorGap: number;
}

function measureGeometry(el: HTMLElement): Geometry {
	const box = el.getBoundingClientRect();
	const rtl = getComputedStyle(el).direction === "rtl";
	// RTL scrollLeft runs from 0 down to negative values; |scrollLeft| is
	// the distance scrolled from the start edge in both directions.
	const scrolled = Math.abs(el.scrollLeft);
	const items = Array.from(el.children);
	const offsets: number[] = [];
	const widths: number[] = [];
	for (const item of items) {
		const r = item.getBoundingClientRect();
		widths.push(r.width);
		// gap + scrolled is the child's position in content coordinates —
		// invariant to further scrolling.
		offsets.push((rtl ? box.right - r.right : r.left - box.left) + scrolled);
	}
	return {
		rtl,
		items,
		offsets,
		widths,
		scrollWidth: el.scrollWidth,
		clientWidth: el.clientWidth,
	};
}

function sameItems(children: HTMLCollection, items: Element[]): boolean {
	return (
		children.length === items.length &&
		Array.from(children).every((child, i) => child === items[i])
	);
}

// Everything a scroll event needs, from cached geometry and scrollLeft.
function derive(el: HTMLElement, g: Geometry): Measurement {
	const scrolled = Math.abs(el.scrollLeft);
	const clientWidth = g.clientWidth;
	const max = g.scrollWidth - clientWidth;
	let first = 0;
	let last = 0;
	let anchorIndex = -1;
	let anchorGap = 0;
	for (const [i, start] of g.offsets.entries()) {
		if (
			start >= scrolled - TOLERANCE_PX &&
			start + g.widths[i] <= scrolled + clientWidth + TOLERANCE_PX
		) {
			if (first === 0) first = i + 1;
			last = i + 1;
		}
		if (anchorIndex === -1 && start - scrolled >= -TOLERANCE_PX) {
			anchorIndex = i;
			anchorGap = start - scrolled;
		}
	}
	return {
		overflows: max > TOLERANCE_PX,
		canPrev: scrolled > TOLERANCE_PX,
		canNext: scrolled < max - TOLERANCE_PX,
		first,
		last,
		total: g.items.length,
		rtl: g.rtl,
		offsets: g.offsets,
		anchorIndex,
		anchorGap,
	};
}

function sameState(a: CarouselState, b: CarouselState) {
	return (Object.keys(a) as (keyof CarouselState)[]).every(
		(k) => a[k] === b[k],
	);
}

function positionOf(m: Measurement): CarouselPosition {
	return m.anchorIndex >= 0
		? { itemIndex: m.anchorIndex, itemGap: m.anchorGap }
		: { itemIndex: Math.max(m.total - 1, 0), itemGap: 0 };
}

// Bring the remembered item back to its remembered distance from the start
// edge; the browser clamps any overshoot to the scrollable range.
function alignTo(el: HTMLElement, m: Measurement, target: CarouselPosition) {
	const start =
		m.offsets[Math.min(Math.max(target.itemIndex, 0), m.offsets.length - 1)];
	if (start === undefined) return;
	const delta = start - Math.abs(el.scrollLeft) - target.itemGap;
	if (Math.abs(delta) <= TOLERANCE_PX) return;
	el.scrollLeft += m.rtl ? -delta : delta;
}

function readStoredPosition(key: string): CarouselPosition | null {
	try {
		const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"itemIndex" in parsed &&
			typeof parsed.itemIndex === "number" &&
			"itemGap" in parsed &&
			typeof parsed.itemGap === "number"
		) {
			return { itemIndex: parsed.itemIndex, itemGap: parsed.itemGap };
		}
	} catch {
		// Storage can be unavailable or hold a stale shape — start fresh then.
	}
	return null;
}

function writeStoredPosition(key: string, position: CarouselPosition): void {
	try {
		sessionStorage.setItem(key, JSON.stringify(position));
	} catch {
		// Positions are a convenience; losing them must never break the UI.
	}
}

const WRITE_DEBOUNCE_MS = 150;

function Chevron({ className }: { className: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			width="18"
			height="18"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M15 18l-6-6 6-6" />
		</svg>
	);
}

/**
 * Horizontal scroll-snap carousel with prev/next buttons (one card per click)
 * and a position indicator. Controls stay hidden while all cards fit.
 * Native touch/trackpad scrolling and keyboard focus scrolling keep working.
 * With scrollStorageKey, the position is also replayed when the items come
 * back after a loading placeholder or an unmount (e.g. an open perush).
 */
export function Carousel({
	className,
	prevLabel,
	nextLabel,
	scrollStorageKey,
	children,
}: CarouselProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [state, setState] = useState(INITIAL_STATE);
	// The latest position this mount is responsible for: read from storage on
	// first sight of the key and kept current on every scroll. While the items
	// cannot show it — a loading placeholder, a display:none subtree, or a
	// viewport wide enough to fit every card — the browser clamps scrollLeft
	// back to the start edge, so a restore stays owed and replays on the first
	// overflowing measurement instead of letting that clamp overwrite the
	// remembered place.
	const positionKeyRef = useRef<string | undefined>(undefined);
	const rememberedPosition = useRef<CarouselPosition | null>(null);
	const restoreOwed = useRef(false);
	// Scroll-invariant child geometry; scroll events derive against it
	// instead of re-measuring every card.
	const geometry = useRef<Geometry | null>(null);
	// Scroll events fire per frame, so position writes are debounced: the
	// in-ref position stays exact each event while sessionStorage catches
	// up when the gesture settles or the carousel unmounts.
	const pendingWrite = useRef<{
		key: string;
		position: CarouselPosition;
	} | null>(null);
	const writeTimer = useRef<number | null>(null);

	const flushStoredPosition = useCallback(() => {
		if (writeTimer.current !== null) {
			clearTimeout(writeTimer.current);
			writeTimer.current = null;
		}
		const pending = pendingWrite.current;
		pendingWrite.current = null;
		if (pending) writeStoredPosition(pending.key, pending.position);
	}, []);

	const scheduleStoredPosition = useCallback(
		(key: string, position: CarouselPosition) => {
			pendingWrite.current = { key, position };
			if (writeTimer.current !== null) clearTimeout(writeTimer.current);
			writeTimer.current = window.setTimeout(() => {
				writeTimer.current = null;
				flushStoredPosition();
			}, WRITE_DEBOUNCE_MS);
		},
		[flushStoredPosition],
	);

	const update = useCallback(
		(reason: "scroll" | "render" | "resize") => {
			// A queued resize/scroll callback can arrive after navigation detaches the ref.
			const el = ref.current;
			if (!el) return;
			let g = geometry.current;
			if (
				!g ||
				reason === "resize" ||
				(reason === "render" && !sameItems(el.children, g.items)) ||
				// Any card's size or position change moves a dimension: re-measure.
				el.scrollWidth !== g.scrollWidth ||
				el.clientWidth !== g.clientWidth
			) {
				g = measureGeometry(el);
				geometry.current = g;
			}
			let next = derive(el, g);

			if (positionKeyRef.current !== scrollStorageKey) {
				positionKeyRef.current = scrollStorageKey;
				rememberedPosition.current = scrollStorageKey
					? readStoredPosition(scrollStorageKey)
					: null;
				restoreOwed.current = true;
			}

			if (!next.overflows) {
				restoreOwed.current = true;
			} else {
				if (restoreOwed.current && rememberedPosition.current) {
					alignTo(el, next, rememberedPosition.current);
					// The scroll just moved every card; the offsets are unchanged.
					next = derive(el, g);
				}
				restoreOwed.current = false;
				const current = positionOf(next);
				rememberedPosition.current = current;
				if (scrollStorageKey)
					scheduleStoredPosition(scrollStorageKey, current);
			}

			const state: CarouselState = {
				overflows: next.overflows,
				canPrev: next.canPrev,
				canNext: next.canNext,
				first: next.first,
				last: next.last,
				total: next.total,
			};
			setState((prev) => (sameState(prev, state) ? prev : state));
		},
		[scrollStorageKey, scheduleStoredPosition],
	);

	// Re-derive after every render: children (loading/empty/cards) may change.
	useEffect(() => update("render"));

	useEffect(() => {
		const el = ref.current as HTMLDivElement;
		const onScroll = () => update("scroll");
		const onResize = () => update("resize");
		el.addEventListener("scroll", onScroll, { passive: true });
		const observer =
			typeof ResizeObserver === "undefined"
				? undefined
				: new ResizeObserver(onResize);
		observer?.observe(el);
		window.addEventListener("resize", onResize);
		return () => {
			el.removeEventListener("scroll", onScroll);
			observer?.disconnect();
			window.removeEventListener("resize", onResize);
			flushStoredPosition();
		};
	}, [update, flushStoredPosition]);

	function scrollByCard(step: 1 | -1) {
		const el = ref.current as HTMLDivElement;
		const box = el.getBoundingClientRect();
		const rtl = getComputedStyle(el).direction === "rtl";
		// Distance from the scroller's inline-start edge to a card's start edge.
		const offset = (item: Element) => {
			const r = item.getBoundingClientRect();
			return rtl ? box.right - r.right : r.left - box.left;
		};
		const items = Array.from(el.children);
		const current = items.findIndex((item) => offset(item) >= -TOLERANCE_PX);
		// Buttons are disabled at the ends, so clamping only guards odd layouts.
		const target =
			items[Math.min(Math.max(current + step, 0), items.length - 1)];
		const delta = offset(target);
		const reduceMotion = window.matchMedia?.(
			"(prefers-reduced-motion: reduce)",
		).matches;
		el.scrollBy({
			left: rtl ? -delta : delta,
			behavior: reduceMotion ? "auto" : "smooth",
		});
	}

	const { overflows, canPrev, canNext, first, last, total } = state;

	return (
		<div className={styles.wrapper}>
			<button
				type="button"
				className={`${styles.navButton} ${styles.prev}`}
				aria-label={prevLabel}
				hidden={!overflows}
				disabled={!canPrev}
				onClick={() => scrollByCard(-1)}
			>
				<Chevron className={styles.prevIcon} />
			</button>
			<div ref={ref} className={className}>
				{children}
			</div>
			<button
				type="button"
				className={`${styles.navButton} ${styles.next}`}
				aria-label={nextLabel}
				hidden={!overflows}
				disabled={!canNext}
				onClick={() => scrollByCard(1)}
			>
				<Chevron className={styles.nextIcon} />
			</button>
			{overflows && first > 0 && (
				<span
					className={styles.position}
					dir="ltr"
					data-testid="carousel-position"
				>
					{first === last ? first : `${first}-${last}`} / {total}
				</span>
			)}
		</div>
	);
}
