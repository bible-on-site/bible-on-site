import type { ReactNode } from "react";
import "./layout.css";

export default function AccessibilityLayout({
	children,
}: {
	children: ReactNode;
}) {
	return <div className="accessibility-layout">{children}</div>;
}
