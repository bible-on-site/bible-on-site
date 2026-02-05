import type React from "react";
import "./layout.css";

export default function RabbisBlessingLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return <div className="rabbis-blessing-layout">{children}</div>;
}
