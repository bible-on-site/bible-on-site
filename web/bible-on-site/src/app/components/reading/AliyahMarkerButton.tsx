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
	type PreviewPosition,
} from "@/app/components/tanahpedia-entry-preview";
import styles from "./reading-unit-text.module.css";

/**
 * Interactive shell for an aliyah boundary pill. SSR keeps the CSS-only
 * inline detail as a no-JS fallback; after hydration the visible detail is
 * portaled to <body> so reading-pane clipping cannot cut it off.
 */
export function AliyahMarkerButton({
	markerKey,
	label,
	role,
	tag,
	category,
	selected,
	detail,
}: {
	markerKey: string;
	label: string;
	role?: "aliyah" | "maftir";
	tag?: string;
	category?: string;
	selected?: boolean;
	detail?: string;
}) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const tooltipRef = useRef<HTMLSpanElement>(null);
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const [tapped, setTapped] = useState(false);
	const [enhanced, setEnhanced] = useState(false);
	const [position, setPosition] = useState<PreviewPosition | null>(null);
	const open = Boolean(detail) && (hovered || focused || tapped);

	useEffect(() => {
		setEnhanced(true);
	}, []);

	const closeDetail = useCallback(() => {
		setHovered(false);
		setFocused(false);
		setTapped(false);
		setPosition(null);
	}, []);

	useLayoutEffect(() => {
		if (!open || !detail) return;
		const button = buttonRef.current;
		const tooltip = tooltipRef.current;
		/* istanbul ignore next -- the portal and button mount in the same commit */
		if (!button || !tooltip) return;
		setPosition(
			computePreviewPosition(
				button.getBoundingClientRect(),
				{ width: tooltip.offsetWidth, height: tooltip.offsetHeight },
				{ width: window.innerWidth, height: window.innerHeight },
				{ gap: 5, margin: 8 },
			),
		);
	}, [open, detail]);

	useEffect(() => {
		if (!open) return;
		const closeIfOutside = (event: Event) => {
			if (
				event.target instanceof Node &&
				buttonRef.current?.contains(event.target)
			) {
				return;
			}
			closeDetail();
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") closeDetail();
		};
		// Book leaves and plain articles scroll in different containers; leaving
		// the detail up after either moves would detach it from its marker.
		document.addEventListener("scroll", closeDetail, true);
		window.addEventListener("resize", closeDetail);
		document.addEventListener("pointerdown", closeIfOutside, true);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("scroll", closeDetail, true);
			window.removeEventListener("resize", closeDetail);
			document.removeEventListener("pointerdown", closeIfOutside, true);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [open, closeDetail]);

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				className={`${styles.aliyahBreakLabel} ${
					enhanced ? styles.aliyahBreakLabelEnhanced : ""
				}`}
				data-aliyah-marker=""
				data-aliyah-key={markerKey}
				data-aliyah-role={role}
				data-aliyah-category={category}
				data-aliyah-selected={selected ? "" : undefined}
				aria-label={detail ?? [tag, label].filter(Boolean).join(" ")}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				onFocus={() => setFocused(true)}
				onBlur={() => {
					setFocused(false);
					setTapped(false);
				}}
				onClick={(event) => {
					// Some touch browsers do not focus a button on tap. Pin the detail
					// there too; outside tap, Escape, scroll or resize dismisses it.
					if (event.currentTarget.ownerDocument.activeElement !== event.currentTarget) {
						setTapped(true);
					}
				}}
			>
				{tag && (
					<span className={styles.aliyahMarkerTag} aria-hidden="true">
						{tag}
					</span>
				)}{" "}
				<span className={styles.aliyahMarkerOrdinal}>{label}</span>
				{detail && (
					<span className={styles.aliyahMarkerDetail} aria-hidden="true">
						{detail}
					</span>
				)}
			</button>
			{open &&
				detail &&
				createPortal(
					<span
						ref={tooltipRef}
						className={`${styles.aliyahMarkerDetail} ${styles.aliyahMarkerDetailPortal}`}
						data-aliyah-detail-portal=""
						dir="rtl"
						aria-hidden="true"
						style={{
							left: position?.x ?? 0,
							top: position?.y ?? 0,
							visibility: position ? "visible" : "hidden",
						}}
					>
						{detail}
					</span>,
					document.body,
				)}
		</>
	);
}
