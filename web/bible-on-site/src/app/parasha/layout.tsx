import type { ReactNode } from "react";
import "./layout.css";

export default function ParashaLayout({ children }: { children: ReactNode }) {
	return <div className="parasha-layout">{children}</div>;
}
