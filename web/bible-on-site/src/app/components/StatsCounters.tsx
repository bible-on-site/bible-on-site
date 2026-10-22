"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./NumbersSection.module.css";

/**
 * Shared count-up duration (seconds) for every counter in
 * "מספרים על הפרק" (#2397): all counters start and finish together,
 * whatever their totals — and the fixed-word item's entrance animation
 * runs on the same clock.
 */
export const STATS_ANIMATION_DURATION_SECONDS = 1.8;
const ANIMATION_DURATION_MS = STATS_ANIMATION_DURATION_SECONDS * 1000;

/** Ease-out cubic: fast start, settles precisely on the target. */
const easeOutCubic = (progress: number) => 1 - (1 - progress) ** 3;

export interface NumericStatItem {
	label: string;
	value: number;
	/**
	 * Optional public destination — when the counter describes something
	 * the visitor can browse (e.g. /929/authors), the whole tile becomes
	 * one understandable link. Counters without a real destination stay
	 * plain text (#2397).
	 */
	href?: string;
}

/**
 * A fixed-word item (e.g. רבנים כותבים על הפרק → עשרות): never a computed
 * count, never animated through numeric values — the word itself gets a
 * restrained entrance animation synchronized with the numeric counters.
 */
export interface TextStatItem {
	label: string;
	text: string;
	/** Optional public destination — see NumericStatItem.href. */
	href?: string;
}

export type StatItem = NumericStatItem | TextStatItem;

const formatNumber = (value: number) => value.toLocaleString("he-IL");

/**
 * Scroll-triggered count-up group. The final totals are rendered
 * server-side and stay in the DOM for assistive technology and no-JS
 * rendering; the visible digits are aria-hidden so increments are never
 * announced. Respects prefers-reduced-motion and browsers without
 * IntersectionObserver by keeping the final values, and animates once
 * per page visit.
 */
export function StatsCounters({ stats }: { stats: StatItem[] }) {
	const ref = useRef<HTMLDListElement>(null);
	const [displayed, setDisplayed] = useState<number[]>(() =>
		stats.map((stat) => ("value" in stat ? stat.value : 0)),
	);
	const [textRevealed, setTextRevealed] = useState(true);

	useEffect(() => {
		const element = ref.current;
		const reduceMotion =
			window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
		if (
			!element ||
			reduceMotion ||
			typeof IntersectionObserver === "undefined"
		) {
			return;
		}

		// The reset happens while the section is still off-screen, so the
		// count-up always starts at the viewport trigger.
		const targets = stats.map((stat) => ("value" in stat ? stat.value : 0));
		setDisplayed(targets.map(() => 0));
		setTextRevealed(false);

		let frame = 0;
		// One observer + one elapsed-time loop drive all counters together:
		// identical duration, identical easing, same start and finish.
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect(); // animate once per page visit
				// The word's CSS transition shares the group's duration, so it
				// finishes its entrance exactly when the counters settle.
				setTextRevealed(true);
				const start = performance.now();
				const tick = (tickNow: number) => {
					const progress = Math.min(
						1,
						(tickNow - start) / ANIMATION_DURATION_MS,
					);
					const eased = easeOutCubic(progress);
					setDisplayed(
						targets.map((target) =>
							Math.min(target, Math.round(target * eased)),
						),
					);
					if (progress < 1) frame = requestAnimationFrame(tick);
				};
				frame = requestAnimationFrame(tick);
			},
			{ threshold: 0.35 },
		);
		observer.observe(element);
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [stats]);

	return (
		<dl ref={ref} className={styles.stats}>
			{stats.map((stat, index) => {
				const finalValue =
					"text" in stat ? stat.text : formatNumber(stat.value);
				const body = "text" in stat ? (
					<>
						<span className={styles.srOnly}>{stat.text}</span>
						<span
							aria-hidden="true"
							className={`${styles.word} ${textRevealed ? "" : styles.wordHidden}`}
						>
							{stat.text}
						</span>
					</>
				) : (
					<>
						<span className={styles.srOnly}>
							{formatNumber(stat.value)}
						</span>
						<span
							aria-hidden="true"
							className={styles.number}
							style={{
								minWidth: `${formatNumber(stat.value).length}ch`,
							}}
						>
							{formatNumber(displayed[index] ?? stat.value)}
						</span>
					</>
				);
				return (
					<div key={stat.label} className={styles.stat}>
						<dt className={styles.label}>{stat.label}</dt>
						<dd className={styles.value}>
							{stat.href ? (
								/* One understandable link target per counter: the anchor
								   covers the whole stat tile via ::after, so the label and
								   value read as a single destination without nested links. */
								<Link
									className={styles.statLink}
									href={stat.href}
									aria-label={`${stat.label}: ${finalValue}`}
								>
									{body}
								</Link>
							) : (
								body
							)}
						</dd>
					</div>
				);
			})}
		</dl>
	);
}
