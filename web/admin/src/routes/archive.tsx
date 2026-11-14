import { createFileRoute, Outlet } from "@tanstack/react-router";
export const Route = createFileRoute("/archive")({
	head: () => ({
		meta: [
			{ title: "ארכיון תוכן פרטי" },
			{ name: "robots", content: "noindex, nofollow, noarchive" },
		],
	}),
	component: Outlet,
});
