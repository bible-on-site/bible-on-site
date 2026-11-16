// Warm the HTTP cache for a Lighthouse audit without leaving teardown debt
// inside the audited navigation. A closed page's document and V8 context are
// torn down lazily: when the next navigation reuses the renderer, that deferred
// teardown lands inside the audited trace as an unattributable top-level
// main-thread task — only V8 safepoint/sweep bookkeeping, no page work — which
// the simulate-mode CPU multiplier can push over the 50ms modeled long-task
// threshold (issue #3163). Committing to about:blank forces the teardown into
// the warm-up window while preserving the warmed storage/cache that
// disableStorageReset relies on.
export async function warmUpAuditTarget(page, url) {
	await page.goto(url, { waitUntil: "networkidle" });
	await page.goto("about:blank");
	await page.close();
}
