/// <reference types="vite/client" />

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	HeadContent,
	Link,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import appCss from "~/styles/app.css?url";

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
		<RootDocument>
			<QueryClientProvider client={queryClient}>
				<Outlet />
			</QueryClientProvider>
		</RootDocument>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="he" dir="rtl">
			<head>
				<HeadContent />
			</head>
			<body className="bg-gray-100 min-h-screen">
				<nav className="bg-white shadow-sm border-b border-gray-200">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
						<div className="flex justify-between h-16">
							<div className="flex items-center gap-8">
								<span className="text-xl font-bold text-blue-600">
									ניהול תנ"ך על הפרק
								</span>
								<div className="flex gap-4">
									<Link
										to="/"
										className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
										activeProps={{ className: "text-blue-600 font-bold" }}
										activeOptions={{ exact: true }}
									>
										בית
									</Link>
									<Link
										to="/articles"
										className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
										activeProps={{ className: "text-blue-600 font-bold" }}
									>
										מאמרים
									</Link>
									<Link
										to="/rabbis"
										className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
										activeProps={{ className: "text-blue-600 font-bold" }}
									>
										רבנים
									</Link>
								</div>
							</div>
						</div>
					</div>
				</nav>
				<main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
					{children}
				</main>
				<TanStackRouterDevtools position="bottom-right" />
				<Scripts />
			</body>
		</html>
	);
}
