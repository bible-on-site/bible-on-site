import Link from "next/link";
import { ShareButton } from "./ShareButton";
import styles from "./article-actions.module.css";

interface ArticleActionsBarProps {
	/** Return label — "חזרה למאמרים" in the book panel, "חזרה לפרק" on the
	 * standalone article route. */
	backLabel: string;
	/** In-panel return handler; omit when backHref renders a real link. */
	onBack?: () => void;
	/** Route target for the return command — renders a real link. */
	backHref?: string;
	sharePath?: string;
	shareTitle?: string;
	/** Article fullscreen is on — the command shows the exit glyph/label. */
	fullscreen?: boolean;
	onToggleFullscreen?: () => void;
	/** "page" re-maps the row to the standalone route's card palette. */
	variant?: "page";
	/** Pins the row while the standalone article route scrolls. */
	sticky?: boolean;
}

/* RTL return arrow — points right (the logical leading edge). */
function BackIcon() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M4 12h15" />
			<path d="m13 5 7 7-7 7" />
		</svg>
	);
}

function ShareIcon() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<circle cx="18" cy="5" r="3" />
			<circle cx="6" cy="12" r="3" />
			<circle cx="18" cy="19" r="3" />
			<path d="m8.6 10.5 6.8-4" />
			<path d="m8.6 13.5 6.8 4" />
		</svg>
	);
}

/* Outward corners — enter fullscreen. */
function ExpandIcon() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M8 3H5a2 2 0 0 0-2 2v3" />
			<path d="M16 3h3a2 2 0 0 1 2 2v3" />
			<path d="M8 21H5a2 2 0 0 1-2-2v-3" />
			<path d="M16 21h3a2 2 0 0 0 2-2v-3" />
		</svg>
	);
}

/* Inward corners — exit fullscreen. */
function CollapseIcon() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M8 3v3a2 2 0 0 1-2 2H3" />
			<path d="M16 3v3a2 2 0 0 0 2 2h3" />
			<path d="M8 21v-3a2 2 0 0 0-2-2H3" />
			<path d="M16 21v-3a2 2 0 0 1 2-2h3" />
		</svg>
	);
}

/**
 * The single article command row (#2786): return navigation at the
 * logical leading edge, Share + Fullscreen grouped at the trailing edge.
 * role="group" rather than role="toolbar" — the bar is a labelled group;
 * a toolbar would owe the full APG keyboard contract.
 */
export function ArticleActionsBar({
	backLabel,
	onBack,
	backHref,
	sharePath,
	shareTitle,
	fullscreen = false,
	onToggleFullscreen,
	variant,
	sticky = false,
}: ArticleActionsBarProps) {
	const barClass = [
		styles.articleActions,
		variant === "page" ? styles.variantPage : "",
		sticky ? styles.sticky : "",
	]
		.filter(Boolean)
		.join(" ");
	const fullscreenLabel = fullscreen ? "יציאה ממסך מלא" : "מסך מלא";

	const backContent = (
		<>
			<BackIcon />
			<span className={styles.actionText}>{backLabel}</span>
		</>
	);

	return (
		<>
			{/* biome-ignore lint/a11y/useSemanticElements: a labelled command
			group — no semantic element covers it, and #2786 rules out
			role="toolbar". */}
			<div
				className={barClass}
				role="group"
				aria-label="פעולות מאמר"
				data-flipbook-no-flip
			>
				{backHref ? (
					<Link href={backHref} className={styles.action} title={backLabel}>
						{backContent}
					</Link>
				) : (
					<button
						type="button"
						className={styles.action}
						onClick={onBack}
						title={backLabel}
					>
						{backContent}
					</button>
				)}
				<div className={styles.actionsGroup}>
					{sharePath && (
						<ShareButton
							canonicalPath={sharePath}
							title={shareTitle}
							className={styles.action}
						>
							<ShareIcon />
							<span className={styles.actionText}>שתף</span>
						</ShareButton>
					)}
					{onToggleFullscreen && (
						<button
							type="button"
							className={styles.action}
							onClick={onToggleFullscreen}
							title={fullscreenLabel}
						>
							{fullscreen ? <CollapseIcon /> : <ExpandIcon />}
							<span className={styles.actionText}>{fullscreenLabel}</span>
						</button>
					)}
				</div>
			</div>
		</>
	);
}
