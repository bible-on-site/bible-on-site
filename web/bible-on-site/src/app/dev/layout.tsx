import type { ReactNode } from "react";
import { PageShell } from "@/app/components/PageShell";

/**
 * Dev tools shell — declares the intentional header-less policy. These
 * routes (e.g. /dev/sefer/{n}) mount a fullscreen debugging surface that
 * covers the chrome; hiding the top bar keeps the DOM honest instead of
 * leaving an unreachable white-on-white bar under the surface (#3161).
 */
export default function DevLayout({ children }: { children: ReactNode }) {
	return <PageShell header="none">{children}</PageShell>;
}
