"use client";

import { useCallback, useState } from "react";
import styles from "./perushim-section.module.css";

interface ShareButtonProps {
	/** The canonical path (e.g. /929/5/רש"י) — combined with origin at runtime. */
	canonicalPath: string;
	/** Optional title for the share dialog. */
	title?: string;
}

/**
 * Share button that uses the Web Share API when available, falling back to clipboard copy.
 * The href attribute on the wrapping anchor makes the canonical URL crawlable.
 */
export function ShareButton({ canonicalPath, title }: ShareButtonProps) {
	const [copied, setCopied] = useState(false);

	const handleClick = useCallback(
		async (e: React.MouseEvent<HTMLAnchorElement>) => {
			e.preventDefault();
			const url = `${window.location.origin}${canonicalPath}`;

			if (navigator.share) {
				try {
					await navigator.share({ title, url });
				} catch {
					/* user cancelled */
				}
				return;
			}

			try {
				await navigator.clipboard.writeText(url);
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			} catch {
				/* clipboard not available */
			}
		},
		[canonicalPath, title],
	);

	return (
		<a
			href={canonicalPath}
			onClick={handleClick}
			className={styles.shareButton}
			aria-label="שיתוף"
			title="שיתוף"
		>
			{copied ? "הועתק!" : "🔗 שתף"}
		</a>
	);
}
