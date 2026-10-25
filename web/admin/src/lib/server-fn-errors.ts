/**
 * Shared error classification for server-function failures.
 *
 * Client-safe (no server-only imports): the admin entry point writes the
 * SESSION_EXPIRED marker into a 401 body for dead sessions, and mutation
 * handlers use the VALIDATION prefix for input errors. The UI classifies
 * thrown values by these markers plus the existing REVISION_CONFLICT prefix
 * so every failure lands in a recognizable bucket with a Hebrew explanation.
 */

/**
 * Body prefix the server entry writes (and the client detects) when a
 * server-function request arrives with a missing/expired Cognito session.
 * Unlike page requests, a server-fn call cannot follow the 302 to Cognito
 * (cross-origin fetch fails), so it gets a 401 text response instead.
 */
export const SESSION_EXPIRED_PREFIX = "SESSION_EXPIRED";

/** Stable message prefix for client-fixable input errors (like conflicts). */
export const VALIDATION_PREFIX = "VALIDATION";

export type SaveErrorKind =
	| "conflict"
	| "session"
	| "network"
	| "validation"
	| "server";

export interface ClassifiedSaveError {
	kind: Exclude<SaveErrorKind, "conflict">;
	/** Hebrew user-facing description of what went wrong. */
	message: string;
	/** Raw error message, for diagnostics/details. */
	detail: string;
}

const NETWORK_ERROR_PATTERN =
	/failed to fetch|network ?error|fetch failed|err_|load resource|timed? ?out|aborted/i;

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function isNetworkError(err: unknown): boolean {
	if (err instanceof TypeError) return true;
	return NETWORK_ERROR_PATTERN.test(errorMessage(err));
}

/**
 * Maps a thrown server-fn error to a user-facing kind + Hebrew message.
 * Conflicts are deliberately excluded — callers route
 * `isRevisionConflictError` matches to the dedicated conflict banner.
 */
export function classifySaveError(err: unknown): ClassifiedSaveError {
	const detail = errorMessage(err);
	if (detail.includes(SESSION_EXPIRED_PREFIX)) {
		return {
			kind: "session",
			message: "פג תוקף ההתחברות - יש להתחבר מחדש כדי לשמור",
			detail,
		};
	}
	if (detail.includes(VALIDATION_PREFIX)) {
		return {
			kind: "validation",
			message: `נתונים שגויים: ${detail.split(VALIDATION_PREFIX).pop()?.trim() || detail}`,
			detail,
		};
	}
	if (isNetworkError(err)) {
		return {
			kind: "network",
			message: "בעיית חיבור לשרת - בדוק את החיבור ונסה שוב",
			detail,
		};
	}
	return {
		kind: "server",
		message: "שגיאת שרת - השמירה נכשלה, נסה שוב",
		detail,
	};
}
