"use client";

import Link from "next/link";
import {
	type JSX,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import styles from "./pasuk-preview-link.module.css";

interface PasukPreviewData {
	reference: string;
	text: string;
	/** Sanitized perush-note snippet — present only for perush citations. */
	noteHtml?: string;
}

const previewCache = new Map<string, PasukPreviewData | null>();

/** Extracts perekId+pasuk (and perush name for perush pages) from tanach hrefs. */
export function parsePasukRefFromHref(
	href: string,
): { perekId: number; pasuk: number; perush?: string } | null {
	const anchor = /^\/929\/(\d+)(?:\/([^?#]+))?(?:\?pasuk=(\d+)|#pasuk-(\d+))$/.exec(
		href,
	);
	if (!anchor) return null;
	const pasukRaw = anchor[3] ?? anchor[4];
	if (!pasukRaw) return null;
	const perushSlug = anchor[2];
	return {
		perekId: Number(anchor[1]),
		pasuk: Number(pasukRaw),
		...(perushSlug ? { perush: decodeURIComponent(perushSlug) } : {}),
	};
}

async function fetchPasukPreview(
	perekId: number,
	pasuk: number,
	perush?: string,
): Promise<PasukPreviewData | null> {
	const key = `${perekId}:${pasuk}:${perush ?? ""}`;
	if (previewCache.has(key)) return previewCache.get(key) ?? null;
	try {
		const query = perush ? `?perush=${encodeURIComponent(perush)}` : "";
		const res = await fetch(`/api/tanah/pasuk/${perekId}/${pasuk}${query}`);
		if (!res.ok) {
			previewCache.set(key, null);
			return null;
		}
		const data: PasukPreviewData = await res.json();
		previewCache.set(key, data);
		return data;
	} catch {
		previewCache.set(key, null);
		return null;
	}
}

/** Tanach citation link showing the pasuk text in a hover preview. */
export function PasukPreviewLink({
	href,
	className,
	children,
}: {
	href: string;
	className?: string;
	children: ReactNode;
}): JSX.Element {
	const pasukRef = parsePasukRefFromHref(href);
	const [preview, setPreview] = useState<PasukPreviewData | null>(null);
	const [visible, setVisible] = useState(false);
	const [position, setPosition] = useState<{ x: number; y: number }>({
		x: 0,
		y: 0,
	});
	const hideTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

	const showPreview = useCallback(
		(e: React.MouseEvent) => {
			if (!pasukRef) return;
			if (hideTimeoutRef.current) {
				clearTimeout(hideTimeoutRef.current);
				hideTimeoutRef.current = null;
			}
			setPosition({ x: e.clientX, y: e.clientY });
			setVisible(true);
			fetchPasukPreview(pasukRef.perekId, pasukRef.pasuk, pasukRef.perush).then(
				setPreview,
			);
		},
		[pasukRef],
	);

	const hidePreview = useCallback(() => {
		hideTimeoutRef.current = setTimeout(() => setVisible(false), 200);
	}, []);

	const keepPreview = useCallback(() => {
		if (hideTimeoutRef.current) {
			clearTimeout(hideTimeoutRef.current);
			hideTimeoutRef.current = null;
		}
	}, []);

	useEffect(() => {
		return () => {
			if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
		};
	}, []);

	const tooltip =
		visible && preview
			? createPortal(
					<div
						role="tooltip"
						className={styles.pasukTooltip}
						style={{ left: position.x, top: position.y }}
						onMouseEnter={keepPreview}
						onMouseLeave={hidePreview}
					>
						<div className={styles.pasukTooltipReference}>
							{preview.reference}
						</div>
						<div className={styles.pasukTooltipText}>{preview.text}</div>
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
