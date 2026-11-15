import type { ReactNode } from "react";
import { PageShell } from "@/app/components/PageShell";
import { geistSans } from "./family-tree-font";

export default function TanahpediaLayout({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<PageShell
			header="solid"
			className={`tanahpedia-layout ${geistSans.variable}`}
		>
			{children}
		</PageShell>
	);
}
