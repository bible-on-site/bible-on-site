import { describe, expect, it } from "vitest";
import { latestContributionAgentResponses } from "~/lib/tanahpedia/contribution-agent-responses";
import type { ContributionEvent } from "~/lib/tanahpedia/contributions";

describe("append-only agent response status", () => {
	const event: ContributionEvent = {
		id: "event",
		kind: "agent_response",
		actor: {
			id: "agent",
			name: "Agent",
			kind: "local_llm",
			isDoradsoft: false,
		},
		body: "summary",
		at: "now",
		revision: 1,
	};
	it("uses the latest receipt per original comment without changing history", () => {
		const events: ContributionEvent[] = [
			{
				...event,
				responses: [
					{ commentId: "one", status: "addressed", body: "done" },
					{ commentId: "two", status: "addressed", body: "also done" },
				],
			},
			{
				...event,
				responses: [
					{
						commentId: "one",
						status: "needs_input",
						body: "new source needed",
					},
				],
			},
		];
		const original = structuredClone(events),
			latest = latestContributionAgentResponses(events);
		expect(latest.get("one")).toEqual({
			commentId: "one",
			status: "needs_input",
			body: "new source needed",
		});
		expect(latest.get("two")?.status).toBe("addressed");
		expect(events).toEqual(original);
	});
	it("does not accept stray response metadata on ordinary comments or queue events", () => {
		const response = {
			commentId: "one",
			status: "addressed" as const,
			body: "not an agent receipt",
		};
		expect(
			latestContributionAgentResponses([
				{ ...event, kind: "comment", responses: [response] },
				{ ...event, kind: "generation_queued", responses: [response] },
				event,
			]).size,
		).toBe(0);
	});
});
