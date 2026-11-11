import { createFileRoute } from "@tanstack/react-router";
import { ArchivePage } from "~/components/archive/ArchivePage";
export const Route = createFileRoute("/archive/$")({
	head: () => ({
		meta: [
			{ title: "ארכיון תוכן פרטי" },
			{ name: "robots", content: "noindex, nofollow, noarchive" },
		],
	}),
	component: ArchivePage,
});
