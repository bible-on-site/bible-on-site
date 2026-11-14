/**
 * Public website origin for user-facing links (open/copy/preview).
 *
 * `VITE_PUBLIC_WEBSITE_URL` is the canonical knob, inlined at build time:
 * in production the runtime also exports `VITE_WEBSITE_URL`, but there it
 * names the cluster-internal revalidation endpoint a browser cannot reach
 * (#2763). The `VITE_WEBSITE_URL` fallback covers dev/test, where one local
 * server plays both roles; a bare build falls back to the local dev site.
 */
export const WEBSITE_BASE = (
	import.meta.env.VITE_PUBLIC_WEBSITE_URL ||
	import.meta.env.VITE_WEBSITE_URL ||
	"http://localhost:3001"
).replace(/\/+$/, "");
