// Import the pure formatter directly — never the barrel: `service.ts` pulls
// `api-client`/mysql2, and this component ships inside client bundles via
// ArticlesSection (#2607).
import { formatReadingTimeLabel } from "@/lib/reading-metrics/format";

interface ReadingTimeProps {
	/** Stored baseline estimate; `null`/`0` render nothing. */
	estimatedSeconds: number | null | undefined;
	className?: string;
}

/**
 * `זמן קריאה משוער` badge — the shared display policy for the persisted
 * reading metrics (#2607): `<60s` → `פחות מדקה`, otherwise minutes rounded
 * up. Unknown or verified-empty metrics render nothing rather than a
 * fabricated estimate.
 */
export function ReadingTime({ estimatedSeconds, className }: ReadingTimeProps) {
	const label = formatReadingTimeLabel(estimatedSeconds);
	if (!label) return null;
	return <span className={className}>{label}</span>;
}
