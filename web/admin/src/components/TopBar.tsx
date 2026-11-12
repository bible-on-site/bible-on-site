import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

const linkClass =
	"text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200";
const activeLink = {
	className: "!text-blue-600 !bg-blue-50 font-semibold",
};

interface ArchiveSession {
	isAdmin: boolean;
	username: string;
}

/**
 * Role lookup for the private archive chrome. Archives cannot reach TanStack
 * server functions (server.tsx blocks them by design), so the bar resolves the
 * session through the dedicated lightweight archive endpoint instead of a
 * loader — which also keeps SSR markup identical for every visitor.
 */
function useArchiveSession(enabled: boolean) {
	return useQuery<ArchiveSession | null>({
		queryKey: ["archive", "session"],
		enabled,
		retry: false,
		// No cross-mount persistence: a remounted bar must re-read the role
		// (post-login entry, expiry). staleTime 0 keeps every enable/remount
		// honest; the mounted observer still serves its cache between renders.
		staleTime: 0,
		gcTime: 0,
		queryFn: async () => {
			const response = await fetch("/archive/api?session", {
				cache: "no-store",
			});
			if (response.status === 401) return null;
			if (!response.ok) throw new Error((await response.json()).error);
			return response.json();
		},
	});
}

function ArchiveLogout({ admin }: { admin: boolean }) {
	const [error, setError] = useState("");
	return (
		<>
			{error && (
				<span role="alert" className="text-sm text-red-600">
					{error}
				</span>
			)}
			<button
				type="button"
				className="text-gray-500 hover:text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200"
				onClick={() => {
					setError("");
					void fetch("/archive/api?logout", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ action: "logout" }),
					})
						.then(async (response) => {
							const result = await response.json();
							if (!response.ok) throw new Error(result.error);
							window.location.assign(result.url);
						})
						.catch((e: Error) => setError(e.message));
				}}
			>
				{admin ? "התנתק" : "יציאה מהחשבון"}
			</button>
		</>
	);
}

function AdminLinks() {
	return (
		<>
			<Link
				to="/"
				className={linkClass}
				activeProps={activeLink}
				activeOptions={{ exact: true }}
			>
				בית
			</Link>
			<Link to="/articles" className={linkClass} activeProps={activeLink}>
				מאמרים
			</Link>
			<Link
				to="/link-proposals"
				search={{ articleId: undefined }}
				className={linkClass}
				activeProps={activeLink}
			>
				הצעות קישור
			</Link>
			<Link to="/bulletins" className={linkClass}>
				עלון יומי
			</Link>
			<Link to="/moadim" className={linkClass} activeProps={activeLink}>
				מועדים
			</Link>
			<Link to="/dedications" className={linkClass} activeProps={activeLink}>
				הקדשות
			</Link>
			<Link to="/rabbis" className={linkClass} activeProps={activeLink}>
				רבנים
			</Link>
			<Link to="/archive" className={linkClass} activeProps={activeLink}>
				ארכיון
			</Link>
			<Link to="/tanahpedia" className={linkClass} activeProps={activeLink}>
				תנכפדיה
			</Link>
		</>
	);
}

/**
 * The shared administration top bar. On archive routes (`archive` variant) the
 * same markup adapts to the actual session: administrators keep the full
 * navigation, archivers see only the archive entry and their account action,
 * and logged-out visitors see the plain brand bar until the page presents its
 * own login card.
 */
export function TopBar({ archive = false }: { archive?: boolean }) {
	const session = useArchiveSession(archive);
	const admin = !archive || session.data?.isAdmin === true;
	return (
		<nav className="bg-white shadow-md border-b border-gray-200 sticky top-0 z-50">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div className="flex justify-between h-16">
					<div className="flex items-center gap-8">
						<Link
							to={admin ? "/" : "/archive"}
							className="flex items-center gap-2"
						>
							<span className="text-2xl">📖</span>
							<span className="text-xl font-bold bg-linear-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">
								ניהול תנ"ך על הפרק
							</span>
						</Link>
						<div className="hidden sm:flex gap-1">
							{admin ? (
								<AdminLinks />
							) : (
								<Link
									to="/archive"
									className={linkClass}
									activeProps={activeLink}
								>
									ארכיון
								</Link>
							)}
						</div>
					</div>
					<div className="flex items-center gap-4">
						{archive ? (
							session.data ? (
								<>
									{!session.data.isAdmin && session.data.username && (
										<span className="hidden sm:inline text-sm text-gray-500">
											שלום, {session.data.username}
										</span>
									)}
									<ArchiveLogout admin={session.data.isAdmin} />
								</>
							) : null
						) : (
							<a
								href="/auth/logout"
								className="text-gray-500 hover:text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200"
							>
								התנתק
							</a>
						)}
					</div>
				</div>
			</div>
		</nav>
	);
}
