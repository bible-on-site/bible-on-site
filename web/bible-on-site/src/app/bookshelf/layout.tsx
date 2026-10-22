import type { ReactNode } from "react";
import "./layout.css";

export default function BookshelfLayout({ children }: { children: ReactNode }) {
	return <div className="bookshelf-layout">{children}</div>;
}
