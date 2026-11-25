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
	const mocked = process.env.MOCK_DATE || readMockDateCookie();
	if (mocked) {
		return new Date(mocked);
	}
	return new Date();
}
