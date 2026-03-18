import type { ReactNode } from "react";
import "./layout.css";

export default function TanahpediaLayout({
	children,
}: {
	children: ReactNode;
}) {
	return <div className="tanahpedia-layout">{children}</div>;
}
