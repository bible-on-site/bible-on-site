/// <reference types="vite/client" />

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { RevalidationWarning } from "~/components/RevalidationWarning";
import { TopBar } from "~/components/TopBar";
import appCss from "../styles/app.css?url";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 1000 * 60 * 5, // 5 minutes
		},
	},
});

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: 'ניהול תנ"ך על הפרק' },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: "/favicon.ico" },
		],
	}),
	component: RootComponent,
});

function RootComponent() {
	return (
		<QueryClientProvider client={queryClient}>
			<RootDocument>
				<Outlet />
			</RootDocument>
		</QueryClientProvider>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	const archive = useRouterState({
		select: (state) =>
			state.location.pathname === "/archive" ||
			state.location.pathname.startsWith("/archive/"),
	});
	return (
		<html lang="he" dir="rtl">
			<head>
				<HeadContent />
			</head>
			<body className="bg-gray-50 min-h-screen font-sans">
				<TopBar archive={archive} />
				{!archive && <RevalidationWarning />}
				<main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
					{children}
				</main>
				{!archive && <TanStackRouterDevtools position="bottom-right" />}
				<Scripts />
			</body>
		</html>
	);
}
