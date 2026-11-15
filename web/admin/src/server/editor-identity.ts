import { getCookie } from "@tanstack/react-start/server";
import { verifyIdTokenClaims } from "./auth";
import { skipAuthEnabled } from "./environment.server";

/**
 * The request-scoped editor identity — callable from other server functions
 * (the link-proposal review/apply path records it as `reviewer`, #3103).
 * Runs inside a server-fn request context, where the session cookie lives.
 * There is no production fallback: an unverified session must NOT inherit a
 * shared identity (a shared-browser "local" scope would leak one editor's
 * unpublished work to the next). Only SKIP_AUTH dev sessions, which have no
 * session cookie at all, share the "local" identity.
 *
 * Server-only module — never imported by client routes; the server-fn
 * wrapper lives in ./session.
 */
export async function resolveEditorIdentity(): Promise<{ id: string }> {
	if (skipAuthEnabled()) {
		return { id: "local" };
	}
	const token = getCookie("admin_session");
	const claims = token ? await verifyIdTokenClaims(token) : null;
	if (!claims?.sub) {
		throw new Error("editor identity unavailable");
	}
	return { id: claims.sub };
}
