import "server-only";

/**
 * Fixed-window in-process rate limiter for the unauthenticated push
 * registration endpoints (#3500).
 *
 * The router's `limit_req` zones only cover crawler-class user agents, so
 * anonymous writes are bounded here: one client address may attempt at
 * most {@link PUSH_REGISTRATION_PER_WINDOW} registration POSTs an hour.
 * Legitimate volume is far lower — the app deduplicates registrations
 * client-side and a browser subscribes once — so the cap only ever bites
 * a scripted source or a heavily shared NAT address. A flood spread over
 * many addresses stays bounded by the per-table row caps in the push
 * services.
 *
 * Buckets are per website task: N running tasks multiply the effective
 * cap by N — acceptable, since the bound exists to keep storage-abuse
 * order of magnitude down, not to hit an exact number.
 */

interface Bucket {
	start: number;
	count: number;
}

/**
 * Returns an `allowed(key, now)` check permitting `limit` hits per
 * `windowMs` per key. Live keys are tracked in a map capped by `maxKeys`:
 * once full of unexpired buckets, brand-new keys are refused instead of
 * evicting live windows or growing memory without bound — a distinct-key
 * flood is itself the abuse being bounded.
 */
export function createRateLimiter(
	limit: number,
	windowMs: number,
	maxKeys = 10_000,
): (key: string, now?: number) => boolean {
	const buckets = new Map<string, Bucket>();
	return (key: string, now = Date.now()): boolean => {
		const bucket = buckets.get(key);
		if (bucket && now - bucket.start < windowMs) {
			if (bucket.count >= limit) return false;
			bucket.count += 1;
			return true;
		}
		if (!bucket && buckets.size >= maxKeys) {
			for (const [other, entry] of buckets) {
				if (now - entry.start >= windowMs) buckets.delete(other);
			}
			if (buckets.size >= maxKeys) return false;
		}
		buckets.set(key, { start: now, count: 1 });
		return true;
	};
}

const HOUR_MS = 60 * 60 * 1000;
// Well above real per-client volume (a handful of registrations a day) and
// shared across both push registration endpoints.
const PUSH_REGISTRATION_PER_WINDOW = 30;

/** Shared bound for `POST /api/push/device` and `POST /api/push/subscription`. */
export const pushRegistrationAllowed = createRateLimiter(
	PUSH_REGISTRATION_PER_WINDOW,
	HOUR_MS,
);

/**
 * The key the registration limiter buckets on. The edge router sets
 * `X-Real-IP` to `$remote_addr` — overwriting any client-sent value — so
 * it is the one address a requester cannot fabricate (`X-Forwarded-For`
 * passes through untrusted and is ignored). Traffic that bypassed the
 * router shares a single "unknown" bucket — bounded too.
 */
export function requestClientKey(request: Request): string {
	return request.headers.get("x-real-ip") ?? "unknown";
}
