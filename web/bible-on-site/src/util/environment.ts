/**
 * Checks if the current environment is production.
 * @returns true if NODE_ENV is 'production', false otherwise
 */
export function isProduction(): boolean {
	return process.env.NODE_ENV === "production";
}
