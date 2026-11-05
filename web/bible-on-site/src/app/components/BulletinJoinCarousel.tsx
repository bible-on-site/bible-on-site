"use client";

import { Children, useRef, useState } from "react";
import styles from "./DailyBulletinSection.module.css";

interface BulletinJoinCarouselProps {
	/** The three join cards, in visual order. */
	children: React.ReactNode;
}

const CARD_COUNT = 3;

function reducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/**
 * RTL scroll-snap carousel for the daily-bulletin join cards (#2941).
 *
 * On narrow screens the cards live in a horizontally scrolling track with
 * scroll snap; prev/next buttons and dots move between cards, and arrow keys
 * work while focus is inside the region. On wide screens all three cards sit
 * side by side and the controls are hidden by CSS — the handlers stay cheap
 * and harmless. The carousel never auto-rotates.
 */
export function BulletinJoinCarousel({ children }: BulletinJoinCarouselProps) {
	const trackRef = useRef<HTMLUListElement>(null);
	const [active, setActive] = useState(0);
	const slides = Children.toArray(children).slice(0, CARD_COUNT);

	function scrollTo(index: number) {
		const wrapped = (index + CARD_COUNT) % CARD_COUNT;
		const slide = trackRef.current?.children[wrapped];
		slide?.scrollIntoView({
			behavior: reducedMotion() ? "auto" : "smooth",
			block: "nearest",
			inline: "center",
		});
	}

	function onScroll() {
		const track = trackRef.current;
		if (!track) return;
		// Rects are viewport-space, so this stays correct in RTL where
		// scrollLeft is negative.
		const center =
			track.getBoundingClientRect().left + track.clientWidth / 2;
		let best = 0;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (let i = 0; i < track.children.length; i += 1) {
			const rect = track.children[i].getBoundingClientRect();
			const distance = Math.abs(rect.left + rect.width / 2 - center);
			if (distance < bestDistance) {
				bestDistance = distance;
				best = i;
			}
		}
		setActive(best);
	}

	function onKeyDown(event: React.KeyboardEvent) {
		// Editable descendants (the email signup field) keep their arrow keys
		// for caret movement; the carousel only handles non-editable targets.
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			(target.isContentEditable ||
				target.closest("input, textarea, select") !== null)
		)
			return;
		// RTL: the "next" card sits to the left.
		if (event.key === "ArrowLeft") {
			event.preventDefault();
			scrollTo(active + 1);
		}
		if (event.key === "ArrowRight") {
			event.preventDefault();
			scrollTo(active - 1);
		}
	}

	return (
		<section
			className={styles.carousel}
			aria-roledescription="קרוסלה"
			aria-label="ערוצי הצטרפות לעלון היומי"
			onKeyDown={onKeyDown}
		>
			<button
				type="button"
				className={`${styles.navButton} ${styles.prevButton}`}
				aria-label="הכרטיס הקודם"
				onClick={() => scrollTo(active - 1)}
			>
				<span aria-hidden="true">❯</span>
			</button>
			<ul className={styles.track} ref={trackRef} onScroll={onScroll}>
				{slides.map((slide, index) => (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: slides are a fixed, ordered set
						key={index}
						className={styles.slide}
					>
						{slide}
					</li>
				))}
			</ul>
			<button
				type="button"
				className={`${styles.navButton} ${styles.nextButton}`}
				aria-label="הכרטיס הבא"
				onClick={() => scrollTo(active + 1)}
			>
				<span aria-hidden="true">❮</span>
			</button>
			<fieldset className={styles.dots} aria-label="בחירת כרטיס">
				{slides.map((_, index) => (
					<button
						// biome-ignore lint/suspicious/noArrayIndexKey: dots mirror the fixed slide order
						key={index}
						type="button"
						className={
							index === active ? `${styles.dot} ${styles.dotActive}` : styles.dot
						}
						aria-label={`כרטיס ${index + 1} מתוך ${CARD_COUNT}`}
						aria-current={index === active || undefined}
						onClick={() => scrollTo(index)}
					/>
				))}
			</fieldset>
		</section>
	);
}
