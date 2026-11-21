import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useArchiveBusy } from "~/lib/archive-busy";

const linkClass =
	"text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200";
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
	// A mid-upload logout clears the session before cleanup can run, stranding
	// the reservation. The archive page publishes its busy flag here so the
	// action stays disabled until the operation settles (matches the removed
	// in-page button, which was disabled while busy).
	const busy = useArchiveBusy();
	return (
		<>
			{error && (
				<span role="alert" className="text-sm text-red-600">
					{error}
				</span>
			)}
			<button
				type="button"
				disabled={busy}
				className="text-gray-500 hover:text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-wait"
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

function AdminLinks({ onNavigate }: { onNavigate: () => void }) {
	return (
		<>
			<Link
				to="/"
				className={linkClass}
				activeProps={activeLink}
				activeOptions={{ exact: true, includeSearch: false }}
				onClick={onNavigate}
			>
				בית
			</Link>
			<Link
				to="/articles"
				className={linkClass}
				activeProps={activeLink}
				onClick={onNavigate}
			>
				מאמרים
			</Link>
			<Link
				to="/bulletins"
				className={linkClass}
				activeProps={activeLink}
				onClick={onNavigate}
			>
				עלון יומי
			</Link>
			<Link
				to="/moadim"
				className={linkClass}
				activeProps={activeLink}
				onClick={onNavigate}
			>
				מועדים
			</Link>
			<Link
				to="/dedications"
				className={linkClass}
				activeProps={activeLink}
				onClick={onNavigate}
			>
				הקדשות
			</Link>
			<Link
				to="/rabbis"
				className={linkClass}
				activeProps={activeLink}
				onClick={onNavigate}
			>
				רבנים
			</Link>
			<Link
				to="/archive"
				className={linkClass}
				activeProps={activeLink}
				onClick={onNavigate}
			>
				ארכיון
			</Link>
			<Link
				to="/tanahpedia"
				className={linkClass}
				activeProps={activeLink}
				onClick={onNavigate}
			>
				תנכפדיה
			</Link>
			<Link
				to="/contribution-agents"
				className={linkClass}
				activeProps={activeLink}
				onClick={onNavigate}
			>
				סוכנים
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
	const [menuOpen, setMenuOpen] = useState(false);
	const [interactive, setInteractive] = useState(false);
	useEffect(() => setInteractive(true), []);
	return (
		<nav
			className="admin-header bg-white shadow-md border-b border-gray-200 sticky top-0 z-50"
			aria-label="ניווט ראשי"
		>
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div className="admin-header-inner">
					<Link to={admin ? "/" : "/archive"} className="admin-header-brand">
						<span className="admin-header-logo" aria-hidden="true">
							<BookOpen size={22} />
						</span>
						<span className="admin-header-title font-bold bg-linear-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">
							ניהול תנ"ך על הפרק
						</span>
					</Link>
					<div
						id="admin-primary-links"
						className="admin-header-links"
						data-collapsible={admin}
						data-open={menuOpen}
					>
						{admin ? (
							<AdminLinks onNavigate={() => setMenuOpen(false)} />
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
					<div className="admin-header-account">
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
					{admin && (
						<button
							type="button"
							className="admin-header-toggle"
							disabled={!interactive}
							aria-expanded={menuOpen}
							aria-controls="admin-primary-links"
							aria-label={
								menuOpen ? "סגירת תפריט הניווט" : "פתיחת תפריט הניווט"
							}
							onClick={() => setMenuOpen((open) => !open)}
						>
							<svg
								width="22"
								height="22"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.8"
								aria-hidden="true"
							>
								<path d="M4 6h16M4 12h16M4 18h16" />
							</svg>
						</button>
					)}
				</div>
			</div>
		</nav>
	);
}
