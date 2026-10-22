import { useQuery } from "@tanstack/react-query";
import { getWebsiteRevalidationStatus } from "~/server/website-revalidate";

/**
 * Warns the editor when the last post-commit website invalidation did not
 * fully apply — the save committed, but the public site still serves stale
 * content until a later save (or an operator call) invalidates it. Polls
 * the server-side failure record; renders nothing while invalidations
 * succeed.
 */
export function RevalidationWarning() {
	const { data } = useQuery({
		queryKey: ["website-revalidation-status"],
		queryFn: () => getWebsiteRevalidationStatus(),
		refetchInterval: 15_000,
	});

	if (!data?.lastFailure) return null;

	return (
		<div className="bg-amber-50 border-b border-amber-200">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 text-sm text-amber-800 font-medium">
				⚠️ עדכון האתר נכשל — ייתכן שהאתר הציבורי מציג תוכן ישן. שמירה חוזרת
				תנסה לרענן שוב.
			</div>
		</div>
	);
}
