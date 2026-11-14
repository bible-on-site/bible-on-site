import { getCookie } from "@tanstack/react-start/server";
import type { JWTPayload } from "jose";
import type { Contributor } from "~/lib/tanahpedia/contributions";
import { verifyIdTokenClaims } from "../auth";
import { skipAuthEnabled } from "../environment.server";

/** Authority comes from a verified account, never an issue author's display name. */
export async function contributionIdentity(): Promise<Contributor> {
	if (skipAuthEnabled()) {
		const name = process.env.TANAHPEDIA_DEV_ACTOR?.trim() || "local";
		return {
			id: `dev:${name}`,
			name,
			kind: "human",
			isDoradsoft: name === "doradsoft",
		};
	}
	const token = getCookie("admin_session");
	const claims: JWTPayload | null = token
		? await verifyIdTokenClaims(token)
		: null;
	if (!claims?.sub) throw new Error("Authenticated human editor required");
	const username =
		typeof claims["cognito:username"] === "string"
			? claims["cognito:username"]
			: "";
	// Federated SSO names differ from GitHub handles. Bind the verified immutable
	// Cognito subject explicitly when its canonical username is not doradsoft.
	const reviewerSub = process.env.TANAHPEDIA_DORADSOFT_SUB?.trim();
	const isDoradsoft = reviewerSub
		? claims.sub === reviewerSub
		: username === "doradsoft";
	return {
		id: claims.sub,
		name: isDoradsoft ? "doradsoft" : username || "עורך",
		kind: "human",
		isDoradsoft,
	};
}
