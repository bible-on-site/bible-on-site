export type ContributionAgentProvider = "local_llm" | "aws_llm";
export type ContributionAgentTask = "issue_implementation" | "pr_resolution";

export interface ContributionAgentTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

/** Immutable declarations, never remotely supplied executable code. */
export interface ContributionAgentBundle {
	protocolVersion: 2;
	version: string;
	hash: string;
	apiVersion: number;
	system: string;
	operationGuide: string[];
	tools: ContributionAgentTool[];
}

export interface RegisteredContributionAgent {
	id: string;
	version: number;
	name: string;
	provider: ContributionAgentProvider;
	model: string | null;
	enabled: boolean;
	installedVersion: string;
	bundleHash: string;
	bundle: ContributionAgentBundle;
	createdAt: string;
	updatedAt: string;
	lastSeenAt: string | null;
	runtimeVersion: string | null;
}

export interface ContributionAgentSummary
	extends Omit<RegisteredContributionAgent, "bundle"> {
	latestVersion: string;
	updateAvailable: boolean;
}

export interface ContributionAgentResponse {
	commentId: string;
	status: "addressed" | "needs_input";
	body: string;
}

export const DEFAULT_LOCAL_AGENT_ID = "00000000-0000-4000-8000-000000000001";
export const DEFAULT_AWS_AGENT_ID = "00000000-0000-4000-8000-000000000002";
