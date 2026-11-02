import type { ReactNode } from "react";
import { geistSans } from "./family-tree-font";
import "./layout.css";

export default function TanahpediaLayout({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<div className={`tanahpedia-layout ${geistSans.variable}`}>{children}</div>
	);
}
