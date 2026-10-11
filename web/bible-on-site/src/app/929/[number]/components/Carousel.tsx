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

interface Measurement extends CarouselState {
	rtl: boolean;
	box: DOMRect;
	items: Element[];
	/** First item whose start edge has not passed the viewport's start edge. */
	anchorIndex: number;
	/** That item's distance from the viewport's start edge. */
	anchorGap: number;
}

function measure(el: HTMLElement): Measurement {
	const box = el.getBoundingClientRect();
	const rtl = getComputedStyle(el).direction === "rtl";
	const items = Array.from(el.children);
	const visible = items.flatMap((item, i) => {
		const r = item.getBoundingClientRect();
		return r.left >= box.left - TOLERANCE_PX &&
			r.right <= box.right + TOLERANCE_PX
			? [i + 1]
			: [];
	});
	// The position anchor: the first item at or past the start edge, and how
	// far its start edge sits from the viewport's — an item-based position
	// that survives card and viewport width changes.
	let anchorIndex = -1;
	let anchorGap = 0;
	for (const [i, item] of items.entries()) {
		const r = item.getBoundingClientRect();
		const gap = rtl ? box.right - r.right : r.left - box.left;
		if (gap >= -TOLERANCE_PX) {
			anchorIndex = i;
			anchorGap = gap;
			break;
		}
	}
	// RTL scrollLeft runs from 0 down to negative values.
	const scrolled = Math.abs(el.scrollLeft);
	const max = el.scrollWidth - el.clientWidth;
	return {
		overflows: max > TOLERANCE_PX,
		canPrev: scrolled > TOLERANCE_PX,
		canNext: scrolled < max - TOLERANCE_PX,
		first: visible[0] ?? 0,
		last: visible[visible.length - 1] ?? 0,
		total: items.length,
		rtl,
		box,
		items,
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
	const item =
		m.items[Math.min(Math.max(target.itemIndex, 0), m.items.length - 1)];
	if (!item) return;
	const r = item.getBoundingClientRect();
	const gap = m.rtl ? m.box.right - r.right : r.left - m.box.left;
	const delta = gap - target.itemGap;
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
	// first sight of the key, kept current on every scroll, and replayed when
	// the items (re)appear so the user never loses their place.
	const positionKeyRef = useRef<string | undefined>(undefined);
	const rememberedPosition = useRef<CarouselPosition | null>(null);
	const firstChildRef = useRef<Element | null | undefined>(undefined);

	const update = useCallback(() => {
		// A queued resize/scroll callback can arrive after navigation detaches the ref.
		const el = ref.current;
		if (!el) return;
		let next = measure(el);

		if (positionKeyRef.current !== scrollStorageKey) {
			positionKeyRef.current = scrollStorageKey;
			rememberedPosition.current = scrollStorageKey
				? readStoredPosition(scrollStorageKey)
				: null;
			firstChildRef.current = undefined;
		}
		const itemsChanged = firstChildRef.current !== el.firstElementChild;
		firstChildRef.current = el.firstElementChild;

		if (next.overflows) {
			const remembered = scrollStorageKey ? rememberedPosition.current : null;
			if (itemsChanged && remembered) {
				alignTo(el, next, remembered);
				// Re-measure: the scroll just moved every card.
				next = measure(el);
			}
			const current = positionOf(next);
			rememberedPosition.current = current;
			if (scrollStorageKey) writeStoredPosition(scrollStorageKey, current);
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
	}, [scrollStorageKey]);

	// Re-measure after every render: children (loading/empty/cards) may change.
	useEffect(update);

	useEffect(() => {
		const el = ref.current as HTMLDivElement;
		el.addEventListener("scroll", update, { passive: true });
		const observer =
			typeof ResizeObserver === "undefined"
				? undefined
				: new ResizeObserver(update);
		observer?.observe(el);
		window.addEventListener("resize", update);
		return () => {
			el.removeEventListener("scroll", update);
			observer?.disconnect();
			window.removeEventListener("resize", update);
		};
	}, [update]);

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
