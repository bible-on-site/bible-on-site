import type { ReactNode } from "react";
import "./layout.css";

export default function SearchLayout({ children }: { children: ReactNode }) {
	return <div className="search-layout">{children}</div>;
}
