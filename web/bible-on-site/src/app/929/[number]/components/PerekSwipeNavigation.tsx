"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

const LAST_PEREK = 929;
const MIN_DISTANCE = 60;
const MAX_DURATION = 700;
const EDGE_INSET = 24;
const INTERACTIVE_SELECTOR =
	'a, button, input, textarea, select, label, summary, nav, dialog, [role="button"], [role="slider"], [role="dialog"], [contenteditable]:not([contenteditable="false"])';

function canStartOn(target: Element, root: HTMLElement) {
	if (target.closest(INTERACTIVE_SELECTOR)) return false;
	// Leave horizontal carousels and other nested scrollers in control of touch.
	for (
		let el: Element | null = target;
		el && el !== root;
		el = el.parentElement
	) {
		if (
			el.scrollWidth > el.clientWidth &&
			/auto|scroll/.test(getComputedStyle(el).overflowX)
		) {
			return false;
		}
	}
	return true;
}

function readerIsBusy() {
	return (
		document.documentElement.hasAttribute("data-book-view") ||
		window.getSelection()?.isCollapsed === false
	);
}

/** Touch-only chapter navigation in the text view, following the app's RTL direction. */
export default function PerekSwipeNavigation({
	children,
	className,
}: {
	children: ReactNode;
	className: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const pathname = usePathname();
	const router = useRouter();

	useEffect(() => {
		const root = ref.current;
		const perekId = Number(pathname.match(/^\/929\/([1-9]\d*)(?:\/|$)/)?.[1]);
		if (!root || !perekId || perekId > LAST_PEREK) return;
		let start: { id: number; x: number; y: number; time: number } | null = null;
		let navigating = false;
		const cancel = () => {
			start = null;
		};
		const onStart = (event: TouchEvent) => {
			cancel();
			if (
				navigating ||
				event.defaultPrevented ||
				event.touches.length !== 1 ||
				readerIsBusy() ||
				!(event.target instanceof Element) ||
				!canStartOn(event.target, root)
			) {
				return;
			}
			const touch = event.touches[0];
			// Reserve screen edges for the browser's own Back/Forward gestures.
			if (
				touch.clientX < EDGE_INSET ||
				touch.clientX > innerWidth - EDGE_INSET
			) {
				return;
			}
			start = {
				id: touch.identifier,
				x: touch.clientX,
				y: touch.clientY,
				time: event.timeStamp,
			};
		};
		const onMove = (event: TouchEvent) => {
			if (!start) return;
			const touch = Array.from(event.touches).find(
				(touch) => touch.identifier === start?.id,
			);
			if (event.defaultPrevented || event.touches.length !== 1 || !touch) {
				cancel();
				return;
			}
			const dx = Math.abs(touch.clientX - start.x);
			const dy = Math.abs(touch.clientY - start.y);
			// Once vertical scrolling starts, drifting sideways must not change chapter.
			if (dy > 10 && dy >= dx) cancel();
		};
		const onEnd = (event: TouchEvent) => {
			const initial = start;
			cancel();
			if (
				!initial ||
				event.defaultPrevented ||
				event.touches.length !== 0 ||
				readerIsBusy()
			) {
				return;
			}
			const touch = Array.from(event.changedTouches).find(
				(touch) => touch.identifier === initial.id,
			);
			if (!touch) return;
			const dx = touch.clientX - initial.x;
			const dy = touch.clientY - initial.y;
			if (
				Math.abs(dx) < MIN_DISTANCE ||
				Math.abs(dx) <= Math.abs(dy) * 1.5 ||
				event.timeStamp - initial.time > MAX_DURATION
			) {
				return;
			}
			const next = perekId + (dx > 0 ? 1 : -1);
			if (next < 1 || next > LAST_PEREK) return;
			if (event.cancelable) event.preventDefault();
			navigating = true;
			router.push(`/929/${next}`);
		};

		root.addEventListener("touchstart", onStart, { passive: true });
		root.addEventListener("touchmove", onMove, { passive: true });
		root.addEventListener("touchend", onEnd, { passive: false });
		root.addEventListener("touchcancel", cancel);
		return () => {
			root.removeEventListener("touchstart", onStart);
			root.removeEventListener("touchmove", onMove);
			root.removeEventListener("touchend", onEnd);
			root.removeEventListener("touchcancel", cancel);
		};
	}, [pathname, router]);

	return (
		<div ref={ref} className={className}>
			{children}
		</div>
	);
}
