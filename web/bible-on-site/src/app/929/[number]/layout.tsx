import "@/lib/download/register-tanach";
import type React from "react";
import { PageShell } from "@/app/components/PageShell";
import PerekSwipeNavigation from "./components/PerekSwipeNavigation";
import ReaderSettings from "./components/ReaderSettings";
import { hebrewSerif, taameyD } from "./hebrew-font";
import "./layout.css";

// Must live in layout (not page) so Next.js passes parent params to
// child generateStaticParams in [slug]/page.tsx.
/* istanbul ignore next: only runs during next build */
export function generateStaticParams() {
	return Array.from({ length: 929 }, (_, i) => ({ number: String(i + 1) }));
}

export default function PerekLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<PageShell
			header="solid"
			className={`perek-layout ${hebrewSerif.variable} ${taameyD.variable}`}
		>
			<PerekSwipeNavigation>
				<ReaderSettings />
				{children}
			</PerekSwipeNavigation>
		</PageShell>
	);
}
