import "@/lib/download/register-tanach";
import localFont from "next/font/local";
import type React from "react";
import { READER_SETTINGS_BOOTSTRAP } from "@/lib/reader-settings";
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
		<div className={`perek-layout ${hebrewSerif.variable}`}>
			{/* Re-apply stored reader settings before first paint (no flash). */}
			<script
				// biome-ignore lint/security/noDangerouslySetInnerHtml: static bootstrap string, no user input
				dangerouslySetInnerHTML={{ __html: READER_SETTINGS_BOOTSTRAP }}
			/>
			<ReaderSettings />
			{children}
		</div>
	);
}
