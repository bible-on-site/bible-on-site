import type React from "react";
import "./layout.css";

export default function AuthorsLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return <div className="authors-layout">{children}</div>;
}
