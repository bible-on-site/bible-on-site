import "@/lib/download/register-tanach";
import localFont from "next/font/local";
import type React from "react";
import { READER_SETTINGS_BOOTSTRAP } from "@/lib/reader-settings";
import PerekSwipeNavigation from "./components/PerekSwipeNavigation";
import ReaderSettings from "./components/ReaderSettings";
import "./layout.css";

/* istanbul ignore next */
const hebrewSerif = localFont({
	src: "../../fonts/NotoSerifHebrew.woff2",
	variable: "--font-tanakh",
	display: "swap",
});

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
		<PerekSwipeNavigation className={`perek-layout ${hebrewSerif.variable}`}>
			{/* Re-apply stored reader settings before first paint (no flash):
			    inline scripts execute during HTML parse, before perek content paints. */}
			<script>{READER_SETTINGS_BOOTSTRAP}</script>
			<ReaderSettings />
			{children}
		</PerekSwipeNavigation>
	);
}
