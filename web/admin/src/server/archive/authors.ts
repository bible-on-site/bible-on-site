import "@tanstack/react-start/server-only";
import {
	CognitoIdentityProviderClient,
	ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { type ArchiveUser, isUploadId } from "~/lib/archive";
import { authConfig } from "./auth";
import { archiveStore } from "./database";

const synchronization = new Map<
	string,
	{ until: number; pending?: Promise<void> }
>();

/** Provision named homes for pre-created Cognito authors before their first login. */
export async function syncAuthorDirectories(actor: ArchiveUser) {
	if (actor.role !== "admin") return;
	const config = authConfig();
	let state = synchronization.get(config.pool);
	if (!state) {
		state = { until: 0 };
		synchronization.set(config.pool, state);
	}
	if (state.until > Date.now()) return;
	const current = state;
	current.pending ??= (async () => {
		const client = new CognitoIdentityProviderClient({ region: config.region });
		let token: string | undefined;
		const seen = new Set<string>();
		do {
			const page = await client.send(
				new ListUsersCommand({
					UserPoolId: config.pool,
					Limit: 60,
					PaginationToken: token,
				}),
			);
			for (let index = 0; index < 60; index++) {
				const user = page.Users?.[index];
				if (!user) break;
				const id = user.Attributes?.find(
					(attribute) => attribute.Name === "sub",
				)?.Value;
				const name = user.Attributes?.find(
					(attribute) => attribute.Name === "name",
				)?.Value;
				if (isUploadId(id) && user.Username && name?.trim())
					await archiveStore.home({
						id,
						username: user.Username,
						name,
						role: "archiver",
					});
			}
			token = page.PaginationToken;
			if (token && seen.has(token))
				throw new Error("Author directory pagination stalled");
			if (token) seen.add(token);
		} while (token);
		current.until = Date.now() + 60_000;
	})().finally(() => {
		current.pending = undefined;
	});
	await current.pending;
}
