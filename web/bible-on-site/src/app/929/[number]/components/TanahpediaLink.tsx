"use client";

import Link from "next/link";
import React, {
	useCallback,
	useEffect,
	useRef,
	useState,
	type JSX,
} from "react";
import { createPortal } from "react-dom";
import styles from "./tanahpedia-link.module.css";

interface PreviewData {
	title: string;
	snippet: string;
}

const previewCache = new Map<string, PreviewData | null>();

async function fetchPreview(
	uniqueName: string,
): Promise<PreviewData | null> {
	if (previewCache.has(uniqueName)) return previewCache.get(uniqueName) ?? null;
	try {
		const res = await fetch(
			`/api/tanahpedia/preview/${encodeURIComponent(uniqueName)}`,
		);
		if (!res.ok) {
			previewCache.set(uniqueName, null);
			return null;
		}
		const data: PreviewData = await res.json();
		previewCache.set(uniqueName, data);
		return data;
	} catch {
		previewCache.set(uniqueName, null);
		return null;
	}
}

export function TanahpediaLink({
	entryUniqueName,
	children,
	className,
}: {
	entryUniqueName: string;
	children: React.ReactNode;
	className?: string;
}): JSX.Element {
	const [preview, setPreview] = useState<PreviewData | null>(null);
	const [visible, setVisible] = useState(false);
	const [position, setPosition] = useState<{ x: number; y: number }>({
		x: 0,
		y: 0,
	});
	const hideTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

	const showPreview = useCallback(
		(e: React.MouseEvent) => {
			if (hideTimeoutRef.current) {
				clearTimeout(hideTimeoutRef.current);
				hideTimeoutRef.current = null;
			}
			setPosition({ x: e.clientX, y: e.clientY });
			setVisible(true);
			fetchPreview(entryUniqueName).then(setPreview);
		},
		[entryUniqueName],
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
						className={styles.previewTooltip}
						style={{ left: position.x, top: position.y }}
						onMouseEnter={keepPreview}
						onMouseLeave={hidePreview}
					>
					<div className={styles.previewTitle}>{preview.title}</div>
					<div
						className={styles.previewSnippet}
						// biome-ignore lint/security/noDangerouslySetInnerHtml: server-sanitized preview HTML
						dangerouslySetInnerHTML={{ __html: preview.snippet }}
					/>
					</div>,
					document.body,
				)
			: null;

	return (
		<>
			<Link
				href={`/tanahpedia/entry/${encodeURIComponent(entryUniqueName)}`}
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
