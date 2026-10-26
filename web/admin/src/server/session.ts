import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { verifyIdTokenClaims } from "./auth";

/**
 * The authenticated editor's stable account identity (the Cognito `sub`).
 * Browser-local entry drafts are scoped by it so two editors sharing a
 * machine — or a session swap — never see each other's drafts. There is no
 * production fallback: an unverified session must NOT inherit a shared key
 * (a shared-browser "local" scope would leak one editor's unpublished work
 * to the next). Only SKIP_AUTH dev sessions, which have no session cookie
 * at all, share the "local" identity.
 */
export const getEditorIdentity = createServerFn({ method: "GET" }).handler(
	async () => {
		if (process.env.SKIP_AUTH === "true") {
			return { id: "local" };
		}
		const token = getCookie("admin_session");
		const claims = token ? await verifyIdTokenClaims(token) : null;
		if (!claims?.sub) {
			throw new Error("editor identity unavailable");
		}
		return { id: claims.sub };
	},
);
