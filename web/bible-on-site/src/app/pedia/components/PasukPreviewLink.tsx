"use client";

import Link from "next/link";
import {
	type ComponentPropsWithoutRef,
	type JSX,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
	computePreviewPosition,
	type PreviewPosition,
} from "@/app/components/tanahpedia-entry-preview";
import { maskDivineNameText } from "@/lib/divine-name-masking";
import {
	getDivineNameMaskingServerSnapshot,
	getDivineNameMaskingSnapshot,
	subscribeDivineNameMasking,
} from "@/lib/divine-name-settings";
import styles from "./pasuk-preview-link.module.css";

interface PasukPreviewData {
	reference: string;
	text: string;
	/** Sanitized perush-note snippet — present only for perush citations. */
	noteHtml?: string;
}

const previewCache = new Map<string, PasukPreviewData | null>();

/** Extracts perekId+pasuk (and perush name + note index for perush pages) from tanach hrefs. */
export function parsePasukRefFromHref(
	href: string,
): { perekId: number; pasuk: number; perush?: string; note?: number } | null {
	// `?pasuk=N` may sit anywhere among the query params — perush-search links
	// append `&note=` and `&q=` after it — so pasuk must be a whole `?`/`&`-delimited
	// param ending in digits; `#pasuk-N` still always ends the href.
	const anchor =
		/^\/929\/(\d+)(?:\/([^?#]+))?(?:\?(?:[^#&]*?&)*?pasuk=(\d+)(?=[&#]|$)|#pasuk-(\d+)$)/.exec(
			href,
		);
	if (!anchor) return null;
	const pasukRaw = anchor[3] ?? anchor[4];
	/* istanbul ignore next -- the regex alternation guarantees one pasuk group; defensive guard */
	if (!pasukRaw) return null;
	const noteRaw = /[?&]note=(\d+)(?=[&#]|$)/.exec(href)?.[1];
	const perushSlug = anchor[2];
	return {
		perekId: Number(anchor[1]),
		pasuk: Number(pasukRaw),
		...(perushSlug ? { perush: decodeURIComponent(perushSlug) } : {}),
		...(noteRaw ? { note: Number(noteRaw) } : {}),
	};
}

async function fetchPasukPreview(
	perekId: number,
	pasuk: number,
	perush?: string,
	note?: number,
): Promise<PasukPreviewData | null> {
	const key = `${perekId}:${pasuk}:${perush ?? ""}:${note ?? ""}`;
	if (previewCache.has(key)) return previewCache.get(key) ?? null;
	try {
		const query = perush
			? `?perush=${encodeURIComponent(perush)}${note != null ? `&note=${note}` : ""}`
			: "";
		const res = await fetch(`/api/tanah/pasuk/${perekId}/${pasuk}${query}`);
		// Failures are not cached: a transient error must not disable the
		// preview for the rest of the session - the next hover retries.
		if (!res.ok) return null;
		const data: PasukPreviewData = await res.json();
		previewCache.set(key, data);
		return data;
	} catch {
		return null;
	}
}

/** Tanach citation link showing the pasuk text in a hover preview. */
export function PasukPreviewLink({
	href,
	className,
	children,
	...rest
}: {
	href: string;
	className?: string;
	children?: ReactNode;
} & Omit<
	ComponentPropsWithoutRef<"a">,
	"href" | "className" | "children" | "onMouseEnter" | "onMouseLeave"
>): JSX.Element {
	const pasukRef = parsePasukRefFromHref(href);
	const masking = useSyncExternalStore(
		subscribeDivineNameMasking,
		getDivineNameMaskingSnapshot,
		getDivineNameMaskingServerSnapshot,
	);
	const [preview, setPreview] = useState<PasukPreviewData | null>(null);
	const [visible, setVisible] = useState(false);
	const [position, setPosition] = useState<PreviewPosition | null>(null);
	const hideTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
	const anchorRef = useRef<HTMLAnchorElement>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);

	const keepPreview = useCallback(() => {
		if (hideTimeoutRef.current) {
			clearTimeout(hideTimeoutRef.current);
			hideTimeoutRef.current = null;
		}
	}, []);

	const showPreview = useCallback(() => {
		if (!pasukRef) return;
		keepPreview();
		setVisible(true);
		fetchPasukPreview(
			pasukRef.perekId,
			pasukRef.pasuk,
			pasukRef.perush,
			pasukRef.note,
		).then(setPreview);
	}, [pasukRef, keepPreview]);

	const closePreview = useCallback(() => {
		keepPreview();
		setVisible(false);
	}, [keepPreview]);

	const hidePreview = useCallback(() => {
		keepPreview();
		hideTimeoutRef.current = setTimeout(closePreview, 200);
	}, [keepPreview, closePreview]);

	useEffect(() => keepPreview, [keepPreview]);

	useEffect(() => {
		if (!visible) return;
		function handleScroll(event: Event) {
			// Scrolling the tooltip's own content leaves its anchor in place.
			if (
				event.target instanceof Node &&
				tooltipRef.current?.contains(event.target)
			) {
				return;
			}
			closePreview();
		}
		document.addEventListener("scroll", handleScroll, true);
		window.addEventListener("resize", closePreview);
		return () => {
			document.removeEventListener("scroll", handleScroll, true);
			window.removeEventListener("resize", closePreview);
		};
	}, [visible, closePreview]);

	// Place the tooltip below the link when it fits, or above it when needed.
	// Cap oversized previews to the roomier side so the link stays clickable.
	useLayoutEffect(() => {
		if (!visible || !preview) return;
		const anchor = anchorRef.current;
		const tooltip = tooltipRef.current;
		if (!anchor || !tooltip) return;
		const rect = anchor.getBoundingClientRect();
		const viewport = { width: window.innerWidth, height: window.innerHeight };
		const room = Math.max(viewport.height - rect.bottom, rect.top) - 10 - 8;
		if (room > 0 && tooltip.offsetHeight > room) {
			tooltip.style.maxHeight = `${room}px`;
		}
		setPosition(
			computePreviewPosition(
				rect,
				{ width: tooltip.offsetWidth, height: tooltip.offsetHeight },
				viewport,
			),
		);
	}, [visible, preview]);

	const tooltip =
		visible && preview
			? createPortal(
					<div
						ref={tooltipRef}
						role="tooltip"
						className={styles.pasukTooltip}
						style={{ left: position?.x ?? 0, top: position?.y ?? 0 }}
						onMouseEnter={keepPreview}
						onMouseLeave={hidePreview}
					>
						<div className={styles.pasukTooltipReference}>
							{preview.reference}
						</div>
						<div className={styles.pasukTooltipText}>
							{maskDivineNameText(preview.text, masking)}
						</div>
						{preview.noteHtml ? (
							<div
								className={styles.pasukTooltipNote}
								// biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized preview HTML (toPreviewHtml)
								dangerouslySetInnerHTML={{ __html: preview.noteHtml }}
							/>
						) : null}
					</div>,
					document.body,
				)
			: null;

	return (
		<>
			<Link
				{...rest}
				ref={anchorRef}
				href={href}
				className={className}
				onMouseEnter={showPreview}
				onMouseLeave={hidePreview}
			>
				{children}
			</Link>
			{tooltip}
		</>
	);
}
