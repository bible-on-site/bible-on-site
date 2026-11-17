import type { ContributionAgentResponse } from "./contribution-agents";
import type { ContributionEvent } from "./contributions";

/** Event order is append-only. A later clarification supersedes an earlier
 * handled receipt, including histories imported from an older agent runtime. */
export function latestContributionAgentResponses(
	events: readonly ContributionEvent[],
): Map<string, ContributionAgentResponse> {
	return new Map(
		events
			.filter((event) => event.kind === "agent_response")
			.flatMap((event) =>
				(event.responses ?? []).map(
					(response) => [response.commentId, response] as const,
				),
			),
	);
}
