"use client";

import { useCallback, useEffect, useRef } from "react";
import {
	positionUnits,
	progressFraction,
	readableDomSegments,
	readingAnchor,
	type PositionedUnit,
	type UnitLineBox,
} from "@/lib/reading-metrics/progress";
import type { ReadingProgressUnit } from "@/lib/reading-metrics/types";
import styles from "./reading-progress.module.css";

export const READING_PROGRESS_LABEL = "התקדמות קריאה";

interface ReadingProgressProps {
	/**
	 * Ordered stored units for the rendered content (`*_metric_block`,
	 * pasuk or note rows). Empty → renders nothing: unknown metrics must
	 * not fabricate a progress bar.
	 */
	units: ReadingProgressUnit[];
	/**
	 * Selector locating the scroll container *above* this bar (resolved
	 * with `closest`, so the bar must render inside it). Omit for the
	 * document scroller (window).
	 */
	scroller?: string;
	/**
	 * Selector locating the element this bar's content queries are scoped
	 * to — also resolved with `closest`. Defaults to the scroller element,
	 * or `document` for the document scroller.
	 */
	scope?: string;
	/**
	 * Selector for the measured content root inside the scope — the
	 * element that wraps exactly the counted text (perek pesukim, article
	 * body, note list, entry body).
	 */
	content: string;
	/**
	 * Selector template locating each keyed unit's element inside the
	 * content root — `{key}` takes the full unit key, `{k1}`/`{k2}` the
	 * colon-split parts (e.g. `[data-perush-pasuk="{k1}"][data-perush-note="{k2}"]`).
	 * Omit for positional mode: the content root is segmented into
	 * readable DOM blocks that align with the stored `*_metric_block`
	 * rows by document order.
	 */
	unitSelector?: string;
	/** Sticky offset from the scroll container's top edge (e.g. `"72px"`). */
	stickyTop?: string;
	/** Extra class for the track (layout hooks only — geometry stays internal). */
	className?: string;
}

interface ScrollGeometry {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
	/** Convert a viewport-space Y into scroll-content coordinates. */
	toContentY(clientTop: number): number;
}

function documentGeometry(): ScrollGeometry {
	const el = document.scrollingElement ?? document.documentElement;
	return {
		scrollTop: el.scrollTop,
		scrollHeight: el.scrollHeight,
		clientHeight: el.clientHeight,
		toContentY: (clientTop) => clientTop + el.scrollTop,
	};
}

function elementGeometry(el: Element): ScrollGeometry {
	return {
		scrollTop: el.scrollTop,
		scrollHeight: el.scrollHeight,
		clientHeight: el.clientHeight,
		toContentY: (clientTop) =>
			clientTop - el.getBoundingClientRect().top + el.scrollTop,
	};
}

/** Text-line boxes of an element/range, in scroll-content coordinates. */
function lineBoxes(rects: DOMRectList, toContentY: (y: number) => number) {
	const lines: UnitLineBox[] = [];
	for (const rect of Array.from(rects)) {
		if (rect.width < 1 || rect.height < 1) continue;
		lines.push({ top: toContentY(rect.top), height: rect.height });
	}
	return lines.sort((a, b) => a.top - b.top);
}

/**
 * Slim word-weighted reading-position bar (#2607). Sticks to the top of its
 * scroll container and fills as counted words pass the reading anchor.
 * Positions are measured once per layout shift (resize, content or font
 * change, async note load) — scroll events only redo the anchor math, so
 * no layout reads run on the scroll path.
 */
export function ReadingProgress({
	units,
	scroller,
	scope,
	content,
	unitSelector,
	stickyTop = "0px",
	className,
}: ReadingProgressProps) {
	const trackRef = useRef<HTMLDivElement>(null);
	const fillRef = useRef<HTMLDivElement>(null);
	const barRef = useRef<HTMLDivElement>(null);

	const locateScroller = useCallback((): Element | null => {
		const host = trackRef.current;
		if (!host || !scroller) return null;
		return host.closest(scroller);
	}, [scroller]);

	const locateContent = useCallback((): Element | null => {
		const host = trackRef.current;
		if (!host) return null;
		const scrollerEl = locateScroller();
		const scopeEl = scope ? host.closest(scope) : scrollerEl;
		if (scopeEl) {
			return scopeEl.matches(content)
				? scopeEl
				: scopeEl.querySelector(content);
		}
		if (document.documentElement.matches(content))
			return document.documentElement;
		return document.querySelector(content);
	}, [content, scope, locateScroller]);

	useEffect(() => {
		const track = trackRef.current;
		const bar = barRef.current;
		if (!track || !bar || units.length === 0) return;
		const scrollerEl = locateScroller();
		const contentEl = locateContent();
		if (!contentEl) return;

		const geometry = () =>
			scrollerEl ? elementGeometry(scrollerEl) : documentGeometry();

		let positioned: PositionedUnit[] = [];
		/** Content-root top from the last measure — a cheap drift detector. */
		let measuredTop = Number.NaN;
		let frame = 0;

		const measure = () => {
			const geo = geometry();
			measuredTop = geo.toContentY(contentEl.getBoundingClientRect().top);
			const geos: {
				top: number;
				bottom: number;
				lines: UnitLineBox[];
				wordCount: number;
			}[] = [];
			if (unitSelector) {
				for (const unit of units) {
					const [k1, k2] = (unit.key ?? "").split(":");
					const selector = unitSelector
						.replace(/\{key\}/g, unit.key ?? "")
						.replace(/\{k1\}/g, k1 ?? "")
						.replace(/\{k2\}/g, k2 ?? "");
					const el = contentEl.querySelector(selector);
					if (!el) {
						geos.push({
							top: measuredTop,
							bottom: measuredTop,
							lines: [],
							wordCount: unit.wordCount,
						});
						continue;
					}
					const range = document.createRange();
					range.selectNodeContents(el);
					const rect = el.getBoundingClientRect();
					geos.push({
						top: geo.toContentY(rect.top),
						bottom: geo.toContentY(rect.bottom),
						lines: lineBoxes(range.getClientRects(), geo.toContentY),
						wordCount: unit.wordCount,
					});
				}
			} else {
				const segments = readableDomSegments(contentEl);
				if (segments.length === units.length) {
					for (let i = 0; i < segments.length; i += 1) {
						const segment = segments[i];
						const range = document.createRange();
						range.setStartBefore(segment[0]);
						range.setEndAfter(segment[segment.length - 1]);
						const rect = range.getBoundingClientRect();
						geos.push({
							top: geo.toContentY(rect.top),
							bottom: geo.toContentY(rect.bottom),
							lines: lineBoxes(range.getClientRects(), geo.toContentY),
							wordCount: units[i].wordCount,
						});
					}
				} else {
					// DOM segmentation diverged from the stored block rows (e.g.
					// sanitization dropped a whole block): fall back to honest
					// position progress over the counted content element itself —
					// still scoped to the counted text, never to page chrome.
					const rect = contentEl.getBoundingClientRect();
					const range = document.createRange();
					range.selectNodeContents(contentEl);
					positioned = [
						{
							wordsBefore: 0,
							wordCount: totalWords,
							top: geo.toContentY(rect.top),
							bottom: geo.toContentY(rect.bottom),
							lines: lineBoxes(
								range.getClientRects(),
								geo.toContentY,
							),
						},
					];
					return;
				}
			}
			positioned = positionUnits(geos);
		};

		const totalWords = units.reduce((sum, u) => sum + u.wordCount, 0);

		const paint = () => {
			frame = 0;
			if (!fillRef.current || !barRef.current) return;
			const geo = geometry();
			// Layout drift above the content (late images, font swap,
			// header growth) invalidates the cached axis silently.
			const top = geo.toContentY(contentEl.getBoundingClientRect().top);
			if (Math.abs(top - measuredTop) > 0.5) measure();
			// The anchor sweeps the *counted content* extent — nav/perushim
			// sections below the text can not hold the bar short of 100%, and
			// reaching the last counted unit completes it even when more
			// scrollable page remains.
			const contentTop = positioned[0]?.top ?? measuredTop;
			const contentBottom =
				positioned[positioned.length - 1]?.bottom ?? measuredTop;
			const anchor = readingAnchor(
				geo.scrollTop,
				geo.scrollHeight,
				geo.clientHeight,
				contentTop,
				contentBottom,
			);
			const fraction = progressFraction(anchor, positioned, totalWords);
			const percent = Math.round(fraction * 1000) / 10;
			fillRef.current.style.width = `${percent}%`;
			barRef.current.setAttribute("aria-valuenow", String(percent));
		};

		const requestPaint = () => {
			if (frame === 0) frame = requestAnimationFrame(paint);
		};

		measure();
		paint();

		const scrollTarget: HTMLElement | Document = scrollerEl
			? (scrollerEl as HTMLElement)
			: document;
		scrollTarget.addEventListener("scroll", requestPaint, {
			passive: true,
		});
		const onResize = () => {
			measure();
			paint();
		};
		window.addEventListener("resize", onResize);
		const observer = new ResizeObserver(() => {
			measure();
			paint();
		});
		observer.observe(contentEl);
		// Late-loading webfonts rewrap lines and move every line box.
		document.fonts?.ready.then(onResize).catch(() => {});

		return () => {
			if (frame !== 0) cancelAnimationFrame(frame);
			scrollTarget.removeEventListener("scroll", requestPaint);
			window.removeEventListener("resize", onResize);
			observer.disconnect();
		};
	}, [units, unitSelector, locateScroller, locateContent]);

	if (units.length === 0) return null;

	return (
		<div
			ref={trackRef}
			className={`${styles.track} ${className ?? ""}`}
			style={{ top: stickyTop }}
		>
			<div
				ref={barRef}
				className={styles.bar}
				role="progressbar"
				aria-label={READING_PROGRESS_LABEL}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={0}
			>
				<div ref={fillRef} className={styles.fill} />
			</div>
		</div>
	);
}
