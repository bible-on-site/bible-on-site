import { latestContributionAgentResponses } from "~/lib/tanahpedia/contribution-agent-responses";
import type { ContributionAgentResponse } from "~/lib/tanahpedia/contribution-agents";
import {
	type Contribution,
	record,
	textField,
	uuidField,
	validateChanges,
} from "~/lib/tanahpedia/contributions";
import {
	assertGeneratedReferences,
	contributionOutputSchema,
	type ModelCatalogue,
} from "./contribution-llm.server";

export function pendingContributionAgentComments(item: Contribution): string[] {
	const responses = latestContributionAgentResponses(item.events);
	return item.events
		.filter(
			(event) =>
				event.actor.kind === "human" &&
				["comment", "changes_requested"].includes(event.kind) &&
				responses.get(event.id)?.status !== "addressed",
		)
		.map((event) => event.id);
}

export function contributionAgentResultSchema(
	item: Contribution,
	catalogue: ModelCatalogue,
) {
	const prs = contributionOutputSchema(catalogue, item.evidence.length)
		.properties.pullRequests;
	const preservesEmpty =
		item.kind === "pr" &&
		item.changes.length === 0 &&
		item.apiMigration?.status === "succeeded";
	const requiresNewOperations =
		item.kind === "pr" && item.changes.length === 0 && !preservesEmpty;
	const draft = {
		...prs.items,
		properties: {
			...prs.items.properties,
			changes: {
				...prs.items.properties.changes,
				minItems: preservesEmpty ? 0 : 1,
			},
		},
	};
	const commentIds = pendingContributionAgentComments(item);
	const shared = {
		summary: { type: "string", minLength: 1, maxLength: 10000 },
		responses: {
			type: "array",
			minItems: item.kind === "pr" ? commentIds.length : 0,
			maxItems: commentIds.length,
			items: {
				type: "object",
				additionalProperties: false,
				required: ["commentId", "status", "body"],
				properties: {
					commentId: commentIds.length
						? { enum: commentIds }
						: { type: "string" },
					status: { enum: ["addressed", "needs_input"] },
					body: { type: "string", minLength: 1, maxLength: 10000 },
				},
			},
		},
	};
	const branch = (outcome: string, payload: Record<string, unknown> = {}) => ({
		type: "object",
		additionalProperties: false,
		required: ["outcome", "summary", "responses", ...Object.keys(payload)],
		properties: { outcome: { const: outcome }, ...shared, ...payload },
	});
	return {
		type: "object",
		oneOf: [
			...(item.kind === "pr"
				? [
						branch("revised", {
							draft: {
								...draft,
								required: requiresNewOperations ? ["changes"] : [],
							},
						}),
					]
				: item.evidence.length
					? [branch("implemented", { pullRequests: { ...prs, minItems: 1 } })]
					: []),
			branch("unchanged"),
			branch("clarification"),
		],
	};
}

export function parseContributionAgentResult(
	content: string,
	item: Contribution,
	catalogue: ModelCatalogue,
) {
	const output = record(JSON.parse(content), "agent result");
	const outcome = output.outcome;
	if (
		!(
			item.kind === "issue"
				? ["implemented", "unchanged", "clarification"]
				: ["revised", "unchanged", "clarification"]
		).includes(String(outcome))
	)
		throw new Error("Invalid agent outcome");
	const allowedFields = [
		"outcome",
		"summary",
		"responses",
		item.kind === "issue" ? "pullRequests" : "draft",
	];
	if (Object.keys(output).some((key) => !allowedFields.includes(key)))
		throw new Error("Unsupported agent result field");
	const summary = textField(output.summary, "agent summary", 10000);
	const pending = pendingContributionAgentComments(item);
	if (!Array.isArray(output.responses) || output.responses.length > 1000)
		throw new Error("Agent responses are required");
	const seen = new Set<string>();
	const responses: ContributionAgentResponse[] = output.responses.map((raw) => {
		const response = record(raw, "agent response"),
			commentId = uuidField(response.commentId, "commentId");
		if (!pending.includes(commentId) || seen.has(commentId))
			throw new Error(
				"Agent response must reference a pending human comment exactly once",
			);
		if (
			Object.keys(response).some(
				(key) => !["commentId", "status", "body"].includes(key),
			) ||
			!["addressed", "needs_input"].includes(String(response.status))
		)
			throw new Error("Invalid agent response");
		seen.add(commentId);
		return {
			commentId,
			status: response.status as ContributionAgentResponse["status"],
			body: textField(response.body, "agent response", 10000),
		};
	});
	if (item.kind === "pr" && pending.some((id) => !seen.has(id)))
		throw new Error(
			"Respond to every pending human comment before completing the PR pass",
		);
	if (outcome !== "implemented" && output.pullRequests !== undefined)
		throw new Error("Only implemented issues may create PRs");
	if (outcome !== "revised" && output.draft !== undefined)
		throw new Error("Only revised PRs may contain a replacement draft");
	let draft:
		| {
				title?: string;
				description?: string;
				evidence?: Contribution["evidence"];
				changes?: ReturnType<typeof validateChanges>;
		  }
		| undefined;
	if (outcome === "revised") {
		const raw = record(output.draft, "agent draft");
		if (
			item.changes.length === 0 &&
			item.apiMigration?.status !== "succeeded" &&
			(raw.changes === undefined ||
				(Array.isArray(raw.changes) && raw.changes.length === 0))
		)
			throw new Error(
				"An empty PR requires a successful API migration to preserve empty changes",
			);
		if (
			Object.keys(raw).some(
				(key) =>
					!["title", "description", "evidenceIndexes", "changes"].includes(key),
			)
		)
			throw new Error("Unsupported agent draft field");
		draft = {};
		if (raw.title !== undefined) draft.title = textField(raw.title, "title");
		if (raw.description !== undefined)
			draft.description = textField(raw.description, "description", 20000);
		if (raw.evidenceIndexes !== undefined) {
			if (
				!Array.isArray(raw.evidenceIndexes) ||
				!raw.evidenceIndexes.length ||
				raw.evidenceIndexes.some(
					(index) =>
						!Number.isInteger(index) ||
						index < 0 ||
						index >= item.evidence.length,
				)
			)
				throw new Error("The agent cited evidence not supplied by the PR");
			draft.evidence = item.evidence.filter((_source, index) =>
				(raw.evidenceIndexes as number[]).includes(index),
			);
		}
		if (raw.changes !== undefined) {
			draft.changes =
				item.changes.length === 0 &&
				item.apiMigration?.status === "succeeded" &&
				Array.isArray(raw.changes) &&
				raw.changes.length === 0
					? []
					: validateChanges(raw.changes);
			assertGeneratedReferences(draft.changes, catalogue);
			const citations = new Set(item.evidence.map((source) => source.citation));
			for (const change of draft.changes)
				for (const field of [
					"sourceCitation",
					"personSourceCitation",
					"sourceText",
				]) {
					const value =
						change.after &&
						(change.after as unknown as Record<string, unknown>)[field];
					if (value && !citations.has(String(value)))
						throw new Error(
							"The agent invented a citation not supplied by the PR",
						);
				}
		}
	}
	return {
		outcome: outcome as
			| "implemented"
			| "revised"
			| "clarification"
			| "unchanged",
		summary,
		responses,
		draft,
		pullRequests: output.pullRequests,
	};
}
