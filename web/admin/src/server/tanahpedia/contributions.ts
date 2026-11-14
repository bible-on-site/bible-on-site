/** Client imports receive RPC stubs; persistence and providers stay server-only. */
import { createServerFn } from "@tanstack/react-start";
import { uuidField } from "~/lib/tanahpedia/contributions";
import { contributionCatalogue } from "./contribution-changes.server";
import { contributionIdentity } from "./contribution-identity.server";
import {
	contributionLlmStatus,
	generateContributionPrs,
} from "./contribution-llm.server";
import {
	createContribution,
	editContribution,
	mergeContribution,
	recoverContributionSequence,
	updateContribution,
} from "./contribution-service.server";
import {
	listContributions,
	readContribution,
	withContributions,
} from "./contribution-store.server";

export const getContributionSession = createServerFn({ method: "GET" }).handler(
	contributionIdentity,
);
export const getContributions = createServerFn({ method: "GET" }).handler(
	async () => {
		await contributionIdentity();
		return listContributions();
	},
);
export const getContribution = createServerFn({ method: "GET" })
	.validator((id: unknown) => uuidField(id, "id"))
	.handler(async ({ data }) => {
		await contributionIdentity();
		return withContributions((conn) => readContribution(conn, data));
	});
export const getContributionCatalogue = createServerFn({
	method: "GET",
}).handler(async () => {
	await contributionIdentity();
	return withContributions(contributionCatalogue);
});
export const createContributionItem = createServerFn({ method: "POST" })
	.validator((data: unknown) => data)
	.handler(async ({ data }) =>
		createContribution(data, await contributionIdentity()),
	);
export const editContributionItem = createServerFn({ method: "POST" })
	.validator((data: unknown) => data)
	.handler(async ({ data }) =>
		editContribution(data, await contributionIdentity()),
	);
export const updateContributionItem = createServerFn({ method: "POST" })
	.validator((data: unknown) => data)
	.handler(async ({ data }) =>
		updateContribution(data, await contributionIdentity()),
	);
export const mergeContributionItem = createServerFn({ method: "POST" })
	.validator((data: unknown) => data)
	.handler(async ({ data }) =>
		mergeContribution(data, await contributionIdentity()),
	);
export const recoverContributionItem = createServerFn({ method: "POST" })
	.validator((data: unknown) => data)
	.handler(async ({ data }) =>
		recoverContributionSequence(data, await contributionIdentity()),
	);
export const getContributionLlmStatus = createServerFn({
	method: "GET",
}).handler(async () => {
	await contributionIdentity();
	return contributionLlmStatus();
});
export const generateIssuePrs = createServerFn({ method: "POST" })
	.validator((data: unknown) => data)
	.handler(async ({ data }) => {
		await contributionIdentity();
		return generateContributionPrs(data);
	});
