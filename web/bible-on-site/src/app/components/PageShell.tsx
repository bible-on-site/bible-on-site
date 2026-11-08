import type { ReactNode } from "react";

/**
 * The declared top-bar treatments a route family may use (issue #3161):
 * - `solid`   — the brand-blue bar (site default; readable everywhere).
 * - `overlay` — the bar stays transparent because the page paints its own
 *   hero backdrop under it (the homepage alHaperekSection).
 * - `none`    — intentional header-less/fullscreen route (dev Sefer view);
 *   the bar is suppressed entirely.
 */
export const PAGE_HEADER_POLICIES = ["solid", "overlay", "none"] as const;
export type PageHeaderPolicy = (typeof PAGE_HEADER_POLICIES)[number];

/**
 * Spreads the family's declared header policy onto its outermost element.
 * The emitted `data-page-header` attribute is the single contract both the
 * global stylesheet (globals.css) and the route-family check
 * (tests/util/page-header-policy.ts) read — so production presentation and
 * validation can never drift apart.
 */
export function pageHeader(policy: PageHeaderPolicy) {
	return { "data-page-header": policy } as const;
}

/**
 * Shared page shell — the one place a route family declares how the global
 * top bar presents over it. Renders the shared full-width overflow
 * container (`.page-shell`) the removed per-feature `*-layout` classes used
 * to duplicate, plus the `data-page-header` policy attribute.
 *
 * It MUST be the outermost element the family renders under `<body>`: the
 * stylesheet keys on a direct body child so a nested layout can neither
 * override nor accidentally hide the family's declaration.
 */
export function PageShell({
	header,
	className,
	children,
}: {
	header: PageHeaderPolicy;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div
			{...pageHeader(header)}
			className={className ? `page-shell ${className}` : "page-shell"}
		>
			{children}
		</div>
	);
}
