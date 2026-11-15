import type { ContributionAgentBundle } from "~/lib/tanahpedia/contribution-agents";

/** A JSON action protocol works with both constrained local decoders and Bedrock. */
export function contributionAgentActionSchema(
	bundle: ContributionAgentBundle,
	resultSchema: Record<string, unknown>,
) {
	return {
		type: "object",
		oneOf: [
			...bundle.tools.map((tool) => ({
				type: "object",
				additionalProperties: false,
				required: ["action", "name", "arguments"],
				properties: {
					action: { const: "tool" },
					name: { const: tool.name },
					arguments: tool.inputSchema,
				},
			})),
			{
				type: "object",
				additionalProperties: false,
				required: ["action", "result"],
				properties: { action: { const: "complete" }, result: resultSchema },
			},
		],
	};
}

export function contributionAgentSystem(bundle: ContributionAgentBundle) {
	return [
		bundle.system,
		"Operation guide:",
		...bundle.operationGuide,
		"Read tools:",
		JSON.stringify(bundle.tools),
		'Every turn returns either {"action":"tool","name":"...","arguments":{...}} or {"action":"complete","result":{...}}. Tool reads do not apply changes.',
	].join("\n");
}
