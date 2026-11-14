import type { ReactNode } from "react";
import { PageShell } from "@/app/components/PageShell";

export default function CalendarLayout({ children }: { children: ReactNode }) {
	return <PageShell header="solid">{children}</PageShell>;
}
