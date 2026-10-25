import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { verifyIdTokenClaims } from "./auth";

/**
 * The authenticated editor's stable account identity (the Cognito `sub`).
 * Browser-local entry drafts are scoped by it so two editors sharing a
 * machine — or a session swap — never see each other's drafts. SKIP_AUTH
 * dev sessions have no session cookie and all share the "local" identity,
 * which is also the unreachable-in-practice fallback for a token that fails
 * verification after the entry gate already accepted it.
 */
export const getEditorIdentity = createServerFn({ method: "GET" }).handler(
	async () => {
		const token = getCookie("admin_session");
		const claims = token ? await verifyIdTokenClaims(token) : null;
		return { id: claims?.sub ?? "local" };
	},
);
