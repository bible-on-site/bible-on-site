let preparation: Promise<void> | undefined;

// These public route families load the shared page renderer, reader, sanitizer
// and calendar modules that API-only health checks do not instantiate.
const pages = ["/929/1", "/929/authors", "/pedia", "/לוח", "/search"];

async function preparePages(): Promise<void> {
	const port = Number(process.env.PORT ?? 3000);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("Invalid website port");
	}
	const results = await Promise.allSettled(
		pages.map(async (page) => {
			const response = await fetch(new URL(page, `http://127.0.0.1:${port}`), {
				cache: "no-store",
				redirect: "error",
				signal: AbortSignal.timeout(2000),
			});
			// Headers alone do not prove the renderer finished: drain the body
			// under the same deadline before publishing readiness.
			const html = await response.text();
			if (
				!response.ok ||
				!response.headers.get("content-type")?.startsWith("text/html") ||
				!html.includes("<html")
			) {
				throw new Error(`Page preparation failed: ${page}`);
			}
		}),
	);
	// Settle every request before allowing another existing health probe to
	// start preparation; a failed page must never leave partial readiness.
	const failed = results.find((result) => result.status === "rejected");
	if (failed) throw failed.reason;
}

/** Prepare actual SSR bundles once before admitting production traffic. */
export async function warmServerPages(): Promise<void> {
	if (process.env.NODE_ENV !== "production") return;
	preparation ??= preparePages().catch((error: unknown) => {
		preparation = undefined;
		throw error;
	});
	return preparation;
}
