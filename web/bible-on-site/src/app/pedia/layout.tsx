import type { ReactNode } from "react";
import { PageShell } from "@/app/components/PageShell";

export default function TanahpediaLayout({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<PageShell header="solid" className="tanahpedia-layout">
			{children}
		</PageShell>
	);
}
