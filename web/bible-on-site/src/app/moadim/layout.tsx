import type { ReactNode } from "react";
import { PageShell } from "@/app/components/PageShell";

/**
 * מועדים על הפרק section shell — declares the standard solid top bar for
 * the landing and moed detail pages (issue #3161; the missing declaration
 * is what left the bar white-on-white here).
 */
export default function MoadimLayout({ children }: { children: ReactNode }) {
	return <PageShell header="solid">{children}</PageShell>;
}
