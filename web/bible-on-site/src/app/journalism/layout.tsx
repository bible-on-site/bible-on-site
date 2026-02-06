import type React from "react";
import "./layout.css";

export default function JournalismLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return <div className="journalism-layout">{children}</div>;
}
