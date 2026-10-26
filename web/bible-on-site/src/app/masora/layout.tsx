import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./layout.css";

// Every Masora view reuses scripture from /929. Keep the landing page,
// units, aliases and book-view query variants out of search while allowing
// crawlers to read this directive and follow links to canonical content.
export const metadata: Metadata = {
	robots: { index: false, follow: true },
};

export default function MasoraLayout({ children }: { children: ReactNode }) {
	return <div className="masora-layout">{children}</div>;
}
