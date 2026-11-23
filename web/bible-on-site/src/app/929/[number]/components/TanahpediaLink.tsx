import Link from "next/link";
import type { JSX, ReactNode } from "react";

/**
 * Entity link inside scripture and commentary text. The
 * `data-tanahpedia-entry` marker lets the site-wide TanahpediaEntryPreview
 * delegate attach its hover/focus popover (#3712); the link itself keeps no
 * state, so it renders identically from server and client trees.
 */
export function TanahpediaLink({
	entryUniqueName,
	children,
	className,
}: {
	entryUniqueName: string;
	children: ReactNode;
	className?: string;
}): JSX.Element {
	return (
		<Link
			href={`/pedia/${encodeURIComponent(entryUniqueName)}`}
			className={className}
			data-tanahpedia-entry={entryUniqueName}
		>
			{children}
		</Link>
	);
}
