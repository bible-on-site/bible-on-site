"use client";

import styles from "./perushim-section.module.css";
import { useArticleShare } from "./use-article-share";

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
	const { outcome, share } = useArticleShare(canonicalPath, title);

	return (
		<a
			href={canonicalPath}
			onClick={(event) => {
				event.preventDefault();
				void share();
			}}
			className={styles.shareButton}
			aria-label="שיתוף"
			title="שיתוף"
		>
			{outcome === "copied"
				? "הועתק!"
				: outcome === "failed"
					? "השיתוף נכשל"
					: "🔗 שתף"}
		</a>
	);
}
