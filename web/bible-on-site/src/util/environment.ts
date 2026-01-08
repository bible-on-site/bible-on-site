/**
 * Checks if the current environment is production.
 * Uses NEXT_PUBLIC_ENV for runtime environment detection.
 * @returns true if NEXT_PUBLIC_ENV is 'production', false otherwise
 */
export function isProduction(): boolean {
	return process.env.NEXT_PUBLIC_ENV === "production";
}
