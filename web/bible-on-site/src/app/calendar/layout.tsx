import type { ReactNode } from "react";
import "./layout.css";

export default function CalendarLayout({ children }: { children: ReactNode }) {
	return <div className="calendar-layout">{children}</div>;
}
