import "server-only";

/** Public monitor-specific read-only keys already published in README.md; not account credentials. */
const MONITORS = {
	"website-co-il": {
		id: 802412112,
		key: "m802412112-744686e8420e32f694a13e96", // gitleaks:allow - public read-only monitor key from README
	},
	"website-com": { id: 802412104, key: "m802412104-4c8ef950c48693c7c215870a" }, // gitleaks:allow - public read-only monitor key from README
	"api-co-il": { id: 802412101, key: "m802412101-379e94ea57230c28073e8b31" }, // gitleaks:allow - public read-only monitor key from README
	"api-com": { id: 802412088, key: "m802412088-05b6aa88f0325e7c194b7ab1" }, // gitleaks:allow - public read-only monitor key from README
} as const;

export type ResponseTimeMonitor = keyof typeof MONITORS;
export const RESPONSE_TIME_CACHE_SECONDS = 300;
const MAX_SAMPLE_AGE_SECONDS = 300;
const FAILURE_CACHE_MS = 60_000;
const MAX_SAMPLES = 200;
const HOUR_SECONDS = 60 * 60;

export interface ResponseTimeSnapshot {
	monitor: ResponseTimeMonitor;
	metric: "ttfb_ms";
	meanMs: number;
	windowStart: string;
	windowEnd: string;
	firstSampleAt: string;
	latestSampleAt: string;
	sampleCount: number;
	fetchedAt: string;
}

// Four allowlisted keys bound both maps. Failures also have a retry TTL: callers
// cannot force more than four upstream requests per minute in this process.
const cache = new Map<
	ResponseTimeMonitor,
	{
		expiresAt: number;
		retryAt: number;
		value: ResponseTimeSnapshot | null;
	}
>();
const inFlight = new Map<
	ResponseTimeMonitor,
	Promise<ResponseTimeSnapshot | null>
>();

export function isResponseTimeMonitor(
	value: string,
): value is ResponseTimeMonitor {
	return Object.hasOwn(MONITORS, value);
}

export function responseTimeExpiresAt(snapshot: ResponseTimeSnapshot): number {
	return Math.min(
		Date.parse(snapshot.fetchedAt) + RESPONSE_TIME_CACHE_SECONDS * 1000,
		Date.parse(snapshot.latestSampleAt) + MAX_SAMPLE_AGE_SECONDS * 1000,
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotFromResponse(
	payload: unknown,
	monitor: ResponseTimeMonitor,
	windowStart: number,
	windowEnd: number,
): ResponseTimeSnapshot | null {
	if (
		!isRecord(payload) ||
		payload.stat !== "ok" ||
		!Array.isArray(payload.monitors)
	)
		return null;
	const rows = payload.monitors;
	if (
		rows.length !== 1 ||
		!isRecord(rows[0]) ||
		rows[0].id !== MONITORS[monitor].id
	)
		return null;
	const points = rows[0].response_times;
	if (
		!Array.isArray(points) ||
		points.length === 0 ||
		points.length > MAX_SAMPLES
	)
		return null;
	let total = 0;
	const timestamps = new Set<number>();
	for (const point of points) {
		if (
			!isRecord(point) ||
			typeof point.datetime !== "number" ||
			!Number.isSafeInteger(point.datetime) ||
			typeof point.value !== "number" ||
			!Number.isFinite(point.value) ||
			point.value < 0 ||
			point.value > 30_000
		)
			return null;
		if (point.datetime < windowStart || point.datetime >= windowEnd) continue;
		if (timestamps.has(point.datetime)) return null;
		timestamps.add(point.datetime);
		total += point.value;
	}
	if (timestamps.size === 0) return null;
	const latest = Math.max(...timestamps);
	const fetchedAt = Date.now();
	// Freshness is measured at fetch completion, not at the window boundary.
	// The API snapshot expires when its newest sample reaches five minutes old.
	if (latest * 1000 + MAX_SAMPLE_AGE_SECONDS * 1000 <= fetchedAt) return null;
	return {
		monitor,
		metric: "ttfb_ms",
		meanMs: Math.round((total / timestamps.size) * 1000) / 1000,
		windowStart: new Date(windowStart * 1000).toISOString(),
		windowEnd: new Date(windowEnd * 1000).toISOString(),
		firstSampleAt: new Date(Math.min(...timestamps) * 1000).toISOString(),
		latestSampleAt: new Date(latest * 1000).toISOString(),
		sampleCount: timestamps.size,
		fetchedAt: new Date(fetchedAt).toISOString(),
	};
}

async function fetchSnapshot(
	monitor: ResponseTimeMonitor,
): Promise<ResponseTimeSnapshot | null> {
	// Rolling 60 minutes ending at the last completed UTC minute.
	const windowEnd = Math.floor(Date.now() / 60_000) * 60;
	const windowStart = windowEnd - HOUR_SECONDS;
	try {
		const response = await fetch("https://api.uptimerobot.com/v2/getMonitors", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			cache: "no-store",
			redirect: "error",
			signal: AbortSignal.timeout(5000),
			body: JSON.stringify({
				api_key: MONITORS[monitor].key,
				response_times: 1,
				response_times_average: 0,
				response_times_limit: MAX_SAMPLES,
				response_times_start_date: windowStart,
				response_times_end_date: windowEnd - 1,
			}),
		});
		if (!response.ok) return null;
		return snapshotFromResponse(
			await response.json(),
			monitor,
			windowStart,
			windowEnd,
		);
	} catch {
		// Upstream failures must become an unavailable badge, never a fabricated
		// zero or a successful response containing an expired measurement window.
		return null;
	}
}

export async function getResponseTime(
	monitor: ResponseTimeMonitor,
): Promise<ResponseTimeSnapshot | null> {
	const cached = cache.get(monitor);
	if (cached) {
		if (cached.expiresAt > Date.now()) return cached.value;
		// A nearly stale success can expire before the minimum retry interval.
		// Report unavailable during that gap without amplifying upstream calls.
		if (cached.retryAt > Date.now()) return null;
	}
	const pending = inFlight.get(monitor);
	if (pending) return pending;
	const request = fetchSnapshot(monitor)
		.then((value) => {
			const retryAt = Date.now() + FAILURE_CACHE_MS;
			cache.set(monitor, {
				expiresAt: value ? responseTimeExpiresAt(value) : retryAt,
				retryAt,
				value,
			});
			return value;
		})
		.finally(() => {
			inFlight.delete(monitor);
		});
	inFlight.set(monitor, request);
	return request;
}
