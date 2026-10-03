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

const TOLERANCE_PX = 2;

const INITIAL_STATE: CarouselState = {
	overflows: false,
	canPrev: false,
	canNext: false,
	first: 0,
	last: 0,
	total: 0,
};

function measure(el: HTMLElement): CarouselState {
	const box = el.getBoundingClientRect();
	const items = Array.from(el.children);
	const visible = items.flatMap((item, i) => {
		const r = item.getBoundingClientRect();
		return r.left >= box.left - TOLERANCE_PX &&
			r.right <= box.right + TOLERANCE_PX
			? [i + 1]
			: [];
	});
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
	};
}

function sameState(a: CarouselState, b: CarouselState) {
	return (Object.keys(a) as (keyof CarouselState)[]).every(
		(k) => a[k] === b[k],
	);
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
 */
export function Carousel({
	className,
	prevLabel,
	nextLabel,
	children,
}: CarouselProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [state, setState] = useState(INITIAL_STATE);

	const update = useCallback(() => {
		const next = measure(ref.current as HTMLDivElement);
		setState((prev) => (sameState(prev, next) ? prev : next));
	}, []);

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
