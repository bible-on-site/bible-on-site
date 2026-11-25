// Wrapper around Date constructor
// In E2E tests, the /api/dev/mock-date API sets process.env.MOCK_DATE on the
// server and a `mock-date` cookie that client components read in the browser.

export const MOCK_DATE_COOKIE = "mock-date";

function readMockDateCookie(): string | undefined {
	if (typeof document === "undefined") {
		return undefined;
	}
	const entry = document.cookie
		.split("; ")
		.find((part) => part.startsWith(`${MOCK_DATE_COOKIE}=`));
	if (!entry) {
		return undefined;
	}
	// The dev API percent-encodes the ISO timestamp when setting the cookie.
	const value = decodeURIComponent(entry.slice(entry.indexOf("=") + 1));
	return value || undefined;
}

export function getCurrentDate(): Date {
	// The cookie channel exists only for local dev/e2e; NODE_ENV is inlined at
	// build time so this stays inert in production bundles even if a user sets
	// the cookie by hand.
	const mocked =
		process.env.MOCK_DATE ||
		(process.env.NODE_ENV !== "production" ? readMockDateCookie() : undefined);
	if (mocked) {
		return new Date(mocked);
	}
	return new Date();
}
