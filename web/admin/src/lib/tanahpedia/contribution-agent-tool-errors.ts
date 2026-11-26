/** Only pure current-call argument rejection is recoverable. Never include raw input or errors. */
export const CONTRIBUTION_AGENT_TOOL_ERRORS = {
	invalid_arguments:
		"The read tool arguments are invalid. Use only its declared fields, kinds and page limits.",
	invalid_article_id:
		"Use the numeric article ID from currentRecords or an article lookup. A PR or discussion UUID is not an article ID.",
	invalid_scripture_book:
		"Use the exact Hebrew book name from a chapter lookup. For example, use שמות, שמואל for both volumes, or שמואל א or שמואל ב for a single volume. Omit book to search the whole Tanakh.",
} as const;

export type ContributionAgentToolErrorReason =
	keyof typeof CONTRIBUTION_AGENT_TOOL_ERRORS;

export interface ContributionAgentToolErrorResult {
	data?: never;
	receipt?: never;
	schema?: never;
	error: {
		type: "invalid_tool_arguments";
		code: ContributionAgentToolErrorReason;
		message: string;
	};
}

export class ContributionAgentToolInputError extends Error {
	constructor(readonly reason: ContributionAgentToolErrorReason) {
		super(CONTRIBUTION_AGENT_TOOL_ERRORS[reason]);
		this.name = "ContributionAgentToolInputError";
	}
}

export function contributionAgentToolErrorResult(
	error: ContributionAgentToolInputError,
): ContributionAgentToolErrorResult {
	return {
		error: {
			type: "invalid_tool_arguments",
			code: error.reason,
			message: CONTRIBUTION_AGENT_TOOL_ERRORS[error.reason],
		},
	};
}
