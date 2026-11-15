/** Client imports receive RPC stubs; persistence and providers stay server-only. */
import { createServerFn } from "@tanstack/react-start";
import {
	record,
	uuidField,
	validateContributionList,
} from "~/lib/tanahpedia/contributions";
import {
	installRegisteredContributionAgent,
	listContributionAgents,
	updateRegisteredContributionAgent,
} from "./contribution-agent-registry.server";
import {
	notifyContributionAgentWork,
	reconcileContributionAgentAssignments,
} from "./contribution-agent-runtime.server";
import { contributionCatalogue } from "./contribution-changes.server";
import { contributionIdentity } from "./contribution-identity.server";
import {
	contributionLlmStatus,
	generateContributionPrs,
} from "./contribution-llm.server";
import { readCurrentContribution } from "./contribution-migrations.server";
import {
	createContribution,
	editContribution,
	mergeContribution,
	recoverContributionSequence,
	updateContribution,
} from "./contribution-service.server";
import {
	listContributions,
	withContributions,
} from "./contribution-store.server";

export const getContributionSession = createServerFn({ method: "GET" }).handler(
	contributionIdentity,
);
export const getContributionAgents = createServerFn({ method: "GET" }).handler(
	async () => {
		await contributionIdentity();
		return listContributionAgents();
	},
);
export const installContributionAgent = createServerFn({ method: "POST" })
	.validator((data: unknown) => data)
	.handler(async ({ data }) => {
		await contributionIdentity();
		return installRegisteredContributionAgent(data);
	});
export const updateContributionAgent = createServerFn({ method: "POST" })
	.validator((data: unknown) => data)
	.handler(async ({ data }) => {
		await contributionIdentity();
		const agent = await updateRegisteredContributionAgent(data);
		if (agent.version === record(data).version) return agent;
		try {
			await reconcileContributionAgentAssignments(agent.id);
		} catch {
			throw new Error(
				"Agent configuration was saved, but pending work could not refresh. Reload and rerun the assigned agent.",
			);
		}
		notifyContributionAgentWork();
		return agent;
	});
export const getContributions = createServerFn({ method: "GET" })
	.validator(validateContributionList)
	.handler(async ({ data }) => {
		await contributionIdentity();
		return listContributions(data);
	});
export const getContribution = createServerFn({ method: "GET" })
	.validator((id: unknown) => uuidField(id, "id"))
	.handler(async ({ data }) => {
		await contributionIdentity();
		return withContributions((conn) => readCurrentContribution(conn, data));
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
