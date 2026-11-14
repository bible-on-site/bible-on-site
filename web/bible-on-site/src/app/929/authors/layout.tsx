import type React from "react";
import { PageShell } from "@/app/components/PageShell";

export default function AuthorsLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return <PageShell header="solid">{children}</PageShell>;
}
