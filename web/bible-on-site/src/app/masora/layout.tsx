import type { ReactNode } from "react";
import "./layout.css";

export default function MasoraLayout({ children }: { children: ReactNode }) {
	return <div className="masora-layout">{children}</div>;
}
