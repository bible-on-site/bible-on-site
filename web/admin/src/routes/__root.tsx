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
			<body className="bg-gray-50 min-h-screen font-sans">
				<nav className="bg-white shadow-md border-b border-gray-200 sticky top-0 z-50">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
						<div className="flex justify-between h-16">
							<div className="flex items-center gap-8">
								<Link to="/" className="flex items-center gap-2">
									<span className="text-2xl">📖</span>
									<span className="text-xl font-bold bg-linear-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">
										ניהול תנ"ך על הפרק
									</span>
								</Link>
								<div className="hidden sm:flex gap-1">
									<Link
										to="/"
										className="text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
										activeProps={{
											className:
												"!text-blue-600 !bg-blue-50 font-semibold",
										}}
										activeOptions={{ exact: true }}
									>
										בית
									</Link>
									<Link
										to="/articles"
										className="text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
										activeProps={{
											className:
												"!text-blue-600 !bg-blue-50 font-semibold",
										}}
									>
										מאמרים
									</Link>
									<Link
										to="/rabbis"
										className="text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
										activeProps={{
											className:
												"!text-blue-600 !bg-blue-50 font-semibold",
										}}
									>
										רבנים
									</Link>
								</div>
							</div>
							<a
								href="/auth/logout"
								className="text-gray-500 hover:text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200"
							>
								התנתק
							</a>
						</div>
					</div>
				</nav>
				<main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
					{children}
				</main>
				<footer className="bg-white border-t border-gray-200 mt-auto py-4">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-gray-500">
						מערכת ניהול תנ"ך על הפרק © {new Date().getFullYear()}
					</div>
				</footer>
				<TanStackRouterDevtools position="bottom-right" />
				<Scripts />
			</body>
		</html>
	);
}
