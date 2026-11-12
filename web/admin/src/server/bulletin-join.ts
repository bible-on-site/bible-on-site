import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { validateJoinLinkChange } from "~/lib/bulletin-join";

/**
 * `changed_by` for the audit trail: verified email, then sub, then a marker.
 * The auth import is lazy so loading this module never requires Cognito
 * env (unit tests, local tooling); an unreadable session degrades to the
 * generic marker rather than blocking a legitimate save — the shared
 * server entry already authenticated the request before dispatch.
 */
async function editorLabel(): Promise<string> {
	if (process.env.SKIP_AUTH === "true") return "local";
	try {
		const { verifyIdTokenClaims } = await import("./auth");
		const token = getCookie("admin_session");
		const claims = token ? await verifyIdTokenClaims(token) : null;
		return (claims?.email ?? claims?.sub ?? "admin").slice(0, 120);
	} catch {
		return "admin";
	}
}

export const getBulletinJoinLinks = createServerFn({ method: "GET" }).handler(
	async () => {
		const { readJoinLinks, readJoinLinkAudit } = await import(
			"./join-links.server"
		);
		const [links, audit] = await Promise.all([
			readJoinLinks(),
			readJoinLinkAudit(undefined, 10),
		]);
		return { links, audit };
	},
);

export const updateBulletinJoinLink = createServerFn({ method: "POST" })
	.validator(validateJoinLinkChange)
	.handler(async ({ data }) => {
		const { updateJoinLink } = await import("./join-links.server");
		return updateJoinLink({ ...data, changedBy: await editorLabel() });
	});
