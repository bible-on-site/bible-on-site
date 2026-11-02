"use client";

import Link from "next/link";
import styles from "./article-actions.module.css";
import { useArticleShare } from "./use-article-share";

interface ArticleActionsProps {
	/** Visible label of the return command (e.g. חזרה למאמרים / חזרה לפרק). */
	backLabel: string;
	/** In-panel return — rendered as a button. Mutually exclusive with backHref. */
	onBack?: () => void;
	/** Route return — rendered as a real link to a known destination. */
	backHref?: string;
	/** Canonical article path the share command publishes. */
	canonicalPath: string;
	/** Optional title passed to the native share sheet. */
	shareTitle?: string;
	/** Article-only fullscreen state; with onToggleFullscreen renders the command. */
	fullscreen?: boolean;
	onToggleFullscreen?: () => void;
}

function BackIcon() {
	return (
		<svg
			className={`${styles.actionIcon} ${styles.iconBack}`}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M19 12H5" />
			<path d="M12 19l-7-7 7-7" />
		</svg>
	);
}

function ShareIcon() {
	return (
		<svg
			className={styles.actionIcon}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<circle cx="18" cy="5" r="3" />
			<circle cx="6" cy="12" r="3" />
			<circle cx="18" cy="19" r="3" />
			<path d="M8.59 13.51l6.83 3.98" />
			<path d="M15.41 6.51l-6.82 3.98" />
		</svg>
	);
}

function ExpandIcon() {
	return (
		<svg
			className={styles.actionIcon}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M8 3H5a2 2 0 0 0-2 2v3" />
			<path d="M21 8V5a2 2 0 0 0-2-2h-3" />
			<path d="M16 21h3a2 2 0 0 0 2-2v-3" />
			<path d="M3 16v3a2 2 0 0 0 2 2h3" />
		</svg>
	);
}

function CollapseIcon() {
	return (
		<svg
			className={styles.actionIcon}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M8 3v3a2 2 0 0 1-2 2H3" />
			<path d="M21 8h-3a2 2 0 0 1-2-2V3" />
			<path d="M16 21v-3a2 2 0 0 1 2-2h3" />
			<path d="M3 16h3a2 2 0 0 1 2 2v3" />
		</svg>
	);
}

/**
 * The single article command row (#2786): return navigation at the logical
 * leading edge, share + article fullscreen grouped at the trailing edge —
 * one base control system for every command. Rendered as a labelled group
 * (native Tab order) inside the article header area so it stays put while
 * the article body scrolls.
 */
export function ArticleActions({
	backLabel,
	onBack,
	backHref,
	canonicalPath,
	shareTitle,
	fullscreen = false,
	onToggleFullscreen,
}: ArticleActionsProps) {
	const { outcome, share } = useArticleShare(canonicalPath, shareTitle);

	const shareLabel =
		outcome === "copied"
			? "הועתק!"
			: outcome === "failed"
				? "השיתוף נכשל"
				: "שתף";
	const shareStatus =
		outcome === "copied"
			? "הקישור למאמר הועתק"
			: outcome === "failed"
				? "השיתוף נכשל"
				: "";

	return (
		<fieldset className={styles.actions} data-flipbook-no-flip>
			<legend className={styles.srOnly}>פעולות מאמר</legend>
			{onBack ? (
				<button
					type="button"
					className={styles.action}
					data-article-action="back"
					onClick={onBack}
				>
					<BackIcon />
					<span>{backLabel}</span>
				</button>
			) : backHref ? (
				<Link
					href={backHref}
					className={styles.action}
					data-article-action="back"
				>
					<BackIcon />
					<span>{backLabel}</span>
				</Link>
			) : null}
			<div className={styles.actionCluster}>
				<button
					type="button"
					className={styles.action}
					data-article-action="share"
					onClick={() => void share()}
				>
					<ShareIcon />
					<span>{shareLabel}</span>
				</button>
				{onToggleFullscreen && (
					<button
						type="button"
						className={styles.action}
						data-article-action="fullscreen"
						onClick={onToggleFullscreen}
					>
						{fullscreen ? <CollapseIcon /> : <ExpandIcon />}
						<span>{fullscreen ? "יציאה ממסך מלא" : "מסך מלא"}</span>
					</button>
				)}
			</div>
			<span role="status" className={styles.srOnly}>
				{shareStatus}
			</span>
		</fieldset>
	);
}
