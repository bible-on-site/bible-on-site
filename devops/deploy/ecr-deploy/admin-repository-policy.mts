import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	DescribeRepositoriesCommand,
	type ECRClient,
	type ImageTagMutability,
	PutImageTagMutabilityCommand,
} from "@aws-sdk/client-ecr";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { assertAPIRepositoryPolicy } from "./api-images.mts";
import { createECRClient, getECRConfig, withRetry } from "./ecr-client.mts";

/**
 * Scoped, rerunnable tag-policy repair for the admin ECR repository (issue
 * #3153). It never touches another repository, image, tag or setting: the only
 * write is PutImageTagMutability on bible-on-site-admin, and only after the
 * live policy is read back and matched against the recorded baseline. Any
 * other observed state refuses the transition instead of guessing.
 */
export const ADMIN_REPOSITORY_NAME = "bible-on-site-admin";

export type TagExclusion = { filterType: string; filter: string };
export type RepositoryTagPolicy = {
	mutability: ImageTagMutability | undefined;
	exclusions: TagExclusion[];
};

/**
 * Live policy recorded for issue #3153 (verified 2026-11-07 in account
 * 250598594267, il-central-1): MUTABLE with no exclusion filters.
 * `rollbackAdminRepositoryPolicy` restores exactly this state.
 */
export const ADMIN_PRIOR_POLICY: RepositoryTagPolicy = {
	mutability: "MUTABLE",
	exclusions: [],
};

/** Publisher contract asserted by assertAPIRepositoryPolicy on the admin release path. */
export const ADMIN_TARGET_POLICY: RepositoryTagPolicy = {
	mutability: "IMMUTABLE_WITH_EXCLUSION",
	exclusions: [{ filterType: "WILDCARD", filter: "latest" }],
};

export function formatTagPolicy(policy: RepositoryTagPolicy): string {
	const exclusions = policy.exclusions.length
		? policy.exclusions
				.map((entry) => `${entry.filterType}:${entry.filter}`)
				.join(", ")
		: "none";
	return `${policy.mutability ?? "unknown"} with exclusion filters: ${exclusions}`;
}

export function sameTagPolicy(
	a: RepositoryTagPolicy,
	b: RepositoryTagPolicy,
): boolean {
	if (
		a.mutability !== b.mutability ||
		a.exclusions.length !== b.exclusions.length
	)
		return false;
	const key = (entry: TagExclusion) => `${entry.filterType}\0${entry.filter}`;
	const keys = new Set(a.exclusions.map(key));
	return b.exclusions.every((entry) => keys.has(key(entry)));
}

export async function describeRepositoryTagPolicy(
	client: ECRClient,
	repositoryName: string,
): Promise<RepositoryTagPolicy> {
	const result = await withRetry(
		() =>
			client.send(
				new DescribeRepositoriesCommand({
					repositoryNames: [repositoryName],
				}),
			),
		{},
		"ECR DescribeRepositories",
	);
	const repository = result.repositories?.find(
		(item) => item.repositoryName === repositoryName,
	);
	if (!repository)
		throw new Error(`Repository ${repositoryName} was not found`);
	return {
		mutability: repository.imageTagMutability,
		exclusions: (repository.imageTagMutabilityExclusionFilters ?? [])
			.filter((entry) => !!entry.filterType && !!entry.filter)
			.map((entry) => ({
				filterType: String(entry.filterType),
				filter: String(entry.filter),
			})),
	};
}

/**
 * A transition is allowed only from the recorded baseline or when the live
 * policy already equals the target (converged — rerunning is a no-op).
 */
export function planPolicyTransition(
	current: RepositoryTagPolicy,
	from: RepositoryTagPolicy,
	to: RepositoryTagPolicy,
	repositoryName: string,
): { action: "apply" | "converged" } {
	if (sameTagPolicy(current, to)) return { action: "converged" };
	if (!sameTagPolicy(current, from))
		throw new Error(
			`Unexpected live tag policy for ${repositoryName}: ` +
				`${formatTagPolicy(current)}; expected ${formatTagPolicy(from)}. ` +
				"Refusing the scoped transition.",
		);
	return { action: "apply" };
}

export type PolicyTransition =
	| { action: "converged"; policy: RepositoryTagPolicy }
	| { action: "applied"; policy: RepositoryTagPolicy };

async function transitionAdminTagPolicy(
	client: ECRClient,
	from: RepositoryTagPolicy,
	to: RepositoryTagPolicy,
): Promise<PolicyTransition> {
	const current = await describeRepositoryTagPolicy(
		client,
		ADMIN_REPOSITORY_NAME,
	);
	const plan = planPolicyTransition(
		current,
		from,
		to,
		ADMIN_REPOSITORY_NAME,
	);
	if (plan.action === "converged")
		return { action: "converged", policy: current };
	const receipt = await withRetry(
		() =>
			client.send(
				new PutImageTagMutabilityCommand({
					repositoryName: ADMIN_REPOSITORY_NAME,
					imageTagMutability: to.mutability,
					// Exclusion filters are only valid for the *_WITH_EXCLUSION
					// settings; a plain MUTABLE rollback must omit them entirely.
					...(to.exclusions.length
						? {
								imageTagMutabilityExclusionFilters: to.exclusions.map(
									(entry) => ({
										filterType: "WILDCARD" as const,
										filter: entry.filter,
									}),
								),
							}
						: {}),
				}),
			),
		{},
		"ECR PutImageTagMutability",
	);
	if (
		(receipt.repositoryName && receipt.repositoryName !== ADMIN_REPOSITORY_NAME) ||
		(receipt.imageTagMutability && receipt.imageTagMutability !== to.mutability)
	)
		throw new Error(
			`Mutability receipt does not match the ${ADMIN_REPOSITORY_NAME} target policy`,
		);
	const applied = await describeRepositoryTagPolicy(
		client,
		ADMIN_REPOSITORY_NAME,
	);
	if (!sameTagPolicy(applied, to))
		throw new Error(
			`Post-change verification failed for ${ADMIN_REPOSITORY_NAME}: ` +
				`expected ${formatTagPolicy(to)}, read back ${formatTagPolicy(applied)}`,
		);
	return { action: "applied", policy: applied };
}

/**
 * Applies the publisher-required policy to bible-on-site-admin only, then
 * re-verifies the live repository through the same guard the release runs.
 */
export async function repairAdminRepositoryPolicy(
	client: ECRClient,
): Promise<PolicyTransition> {
	const transition = await transitionAdminTagPolicy(
		client,
		ADMIN_PRIOR_POLICY,
		ADMIN_TARGET_POLICY,
	);
	await assertAPIRepositoryPolicy(client, ADMIN_REPOSITORY_NAME);
	return transition;
}

/** Restores the recorded prior policy (MUTABLE, no exclusion filters). */
export async function rollbackAdminRepositoryPolicy(
	client: ECRClient,
): Promise<PolicyTransition> {
	return transitionAdminTagPolicy(
		client,
		ADMIN_TARGET_POLICY,
		ADMIN_PRIOR_POLICY,
	);
}

function planDescription(
	current: RepositoryTagPolicy,
	from: RepositoryTagPolicy,
	to: RepositoryTagPolicy,
): string {
	try {
		const plan = planPolicyTransition(
			current,
			from,
			to,
			ADMIN_REPOSITORY_NAME,
		);
		return plan.action === "converged"
			? `converged at ${formatTagPolicy(to)}`
			: `would apply ${formatTagPolicy(to)}`;
	} catch (error) {
		return `refused: ${(error as Error).message}`;
	}
}

async function main(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.usage(
			"Scoped bible-on-site-admin ECR tag-policy repair (issue #3153). " +
				"The only write is PutImageTagMutability on that one repository, " +
				"and only after the live policy matches the recorded baseline. " +
				"Mutating runs require the explicit AWS approval recorded on the PR.",
		)
		.option("verify", {
			type: "boolean",
			default: false,
			describe:
				"Read-only: report the live policy and the planned transitions",
		})
		.option("rollback", {
			type: "boolean",
			default: false,
			describe:
				"Restore the recorded prior policy (MUTABLE, no exclusion filters)",
		})
		.strict()
		.help()
		.parse();

	const config = await getECRConfig();
	console.info(`Using AWS region: ${config.region}`);
	const client = createECRClient(config);
	const current = await describeRepositoryTagPolicy(
		client,
		ADMIN_REPOSITORY_NAME,
	);
	console.info(
		`Live ${ADMIN_REPOSITORY_NAME} tag policy: ${formatTagPolicy(current)}`,
	);
	if (argv.verify) {
		console.info(
			`repair: ${planDescription(current, ADMIN_PRIOR_POLICY, ADMIN_TARGET_POLICY)}`,
		);
		console.info(
			`rollback: ${planDescription(current, ADMIN_TARGET_POLICY, ADMIN_PRIOR_POLICY)}`,
		);
		if (
			!sameTagPolicy(current, ADMIN_PRIOR_POLICY) &&
			!sameTagPolicy(current, ADMIN_TARGET_POLICY)
		)
			throw new Error(
				`Live ${ADMIN_REPOSITORY_NAME} policy matches neither the recorded baseline nor the repair target`,
			);
		return;
	}
	const result = argv.rollback
		? await rollbackAdminRepositoryPolicy(client)
		: await repairAdminRepositoryPolicy(client);
	console.info(
		result.action === "converged"
			? `${ADMIN_REPOSITORY_NAME} already matches the requested policy: ${formatTagPolicy(result.policy)}`
			: `${ADMIN_REPOSITORY_NAME} tag policy updated and verified: ${formatTagPolicy(result.policy)}`,
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	try {
		await main();
	} catch (error) {
		console.error("Admin repository policy repair failed:", error);
		process.exit(1);
	}
