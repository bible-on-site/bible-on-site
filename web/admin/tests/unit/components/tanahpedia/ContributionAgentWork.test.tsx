import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	AgentCommentResponse,
	AgentResponseLinks,
	AgentWorkStatus,
	isAgentAssigned,
	latestAgentResponses,
} from "~/components/tanahpedia/ContributionAgentWork";
import type { ContributionAgentSummary } from "~/lib/tanahpedia/contribution-agents";
import type {
	Contribution,
	ContributionEvent,
	ContributionGeneration,
} from "~/lib/tanahpedia/contributions";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		search,
		children,
	}: {
		search: { id: string };
		children: React.ReactNode;
	}) => <a href={`/pull-requests?id=${search.id}`}>{children}</a>,
}));

function item(generation?: Partial<ContributionGeneration>): Contribution {
	return {
		id: "issue",
		number: 1,
		kind: "pr",
		state: "open",
		title: "Title",
		description: "Description",
		author: { id: "author", name: "Author", kind: "human", isDoradsoft: false },
		assignee: { kind: "local_llm" },
		evidence: [],
		changes: [],
		issueId: null,
		revision: 1,
		version: 1,
		events: [],
		createdAt: "2026-11-15T00:00:00Z",
		updatedAt: "2026-11-15T00:00:00Z",
		closeIssue: true,
		provenance: null,
		...(generation
			? {
					generation: {
						id: "job",
						status: "queued",
						requestedAt: "2026-11-15T00:00:00Z",
						requestedBy: "human",
						attempts: 0,
						apiVersion: 4,
						worker: null,
						model: null,
						leaseHash: null,
						leaseExpiresAt: null,
						claimedVersion: null,
						contextHash: null,
						outputHash: null,
						prIds: [],
						error: null,
						...generation,
					},
				}
			: {}),
	};
}

describe("agent work evidence", () => {
	it("does not manufacture a work status before an assignment has queued work", () => {
		const discussion = item();
		const { container } = render(<AgentWorkStatus item={discussion} />);
		expect(container).toBeEmptyDOMElement();
		expect(isAgentAssigned(discussion)).toBe(true);
		expect(
			isAgentAssigned({
				...discussion,
				assignee: { kind: "human", id: "owner", name: "Owner" },
			}),
		).toBe(false);
	});
	it.each([
		["queued", "העבודה נמצאת בתור"],
		["running", "הסוכן מטפל בדיון"],
		["completed", "הסוכן סיים את העבודה"],
		["needs_input", "הסוכן ממתין להבהרה"],
		["failed", "עבודת הסוכן נכשלה"],
		["cancelled", "עבודת הסוכן בוטלה"],
	] as const)(
		"shows the server's %s state on an assigned PR",
		(status, label) => {
			render(
				<AgentWorkStatus
					item={item({ status, leaseExpiresAt: "2099-01-01T00:00:00Z" })}
				/>,
			);
			expect(screen.getByRole("status")).toHaveTextContent(label);
		},
	);
	it("keeps an expired running lease distinct from completed work", () => {
		render(
			<AgentWorkStatus
				item={item({
					status: "running",
					leaseExpiresAt: "2000-01-01T00:00:00Z",
				})}
			/>,
		);
		expect(screen.getByRole("status")).toHaveTextContent("ממתין לעובד זמין");
		expect(screen.queryByText("הסוכן סיים את העבודה")).not.toBeInTheDocument();
	});
	it("shows the registered agent's name and distinguishes issue implementation from an edited PR revision", () => {
		const discussion = {
			...item({
				status: "completed",
				agentId: "registered",
				result: {
					outcome: "implemented",
					summary: "Created a draft for review",
					addressedCommentIds: [],
					pendingCommentIds: [],
					revision: 1,
					changed: true,
				},
			}),
			kind: "issue" as const,
		};
		render(
			<AgentWorkStatus
				item={discussion}
				agents={[
					{
						id: "registered",
						name: "My workstation",
					} as ContributionAgentSummary,
				]}
			/>,
		);
		expect(screen.getByText("My workstation")).toBeInTheDocument();
		expect(screen.getByText("Created a draft for review")).toBeInTheDocument();
		expect(screen.queryByText(/ההצעה עודכנה לגרסה/)).not.toBeInTheDocument();
	});
	it("renders the result, current work version and exact triggering comments without granting approval", () => {
		render(
			<AgentWorkStatus
				item={item({
					status: "needs_input",
					provider: "aws_llm",
					worker: "worker-1",
					model: "model",
					bundleVersion: "agent-v2",
					trigger: "comment",
					triggerEventIds: ["human-comment"],
					prIds: ["pr-2"],
					error: "An explanation is needed",
					result: {
						outcome: "clarification",
						summary: "Please confirm this source",
						addressedCommentIds: [],
						pendingCommentIds: ["human-comment"],
						revision: 3,
						changed: true,
					},
				})}
			/>,
		);
		expect(screen.getByText(/AWS LLM/)).toBeInTheDocument();
		expect(screen.getByText("agent-v2")).toBeInTheDocument();
		expect(screen.getByText("Please confirm this source")).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"An explanation is needed",
		);
		expect(screen.getByRole("link", { name: "אירוע 1" })).toHaveAttribute(
			"href",
			"#contribution-event-human-comment",
		);
		expect(screen.getByRole("link", { name: /פתיחת הצעה/ })).toHaveAttribute(
			"href",
			"/pull-requests?id=pr-2",
		);
		expect(screen.getByText(/נדרשת סקירה לפי כללי האישור/)).toBeInTheDocument();
	});
	it("distinguishes queued workstation work from queued AWS work", () => {
		const { rerender } = render(<AgentWorkStatus item={item({})} />);
		expect(
			screen.getByText(/עד שהעובד בתחנת העבודה יתחבר/),
		).toBeInTheDocument();
		rerender(
			<AgentWorkStatus item={{ ...item({}), assignee: { kind: "aws_llm" } }} />,
		);
		expect(screen.getByText(/הדיון המלא/)).toBeInTheDocument();
	});
	it("keeps original comments immutable and uses the latest response to each comment across the whole history", () => {
		const base = {
			id: "response",
			kind: "agent_response",
			actor: {
				id: "agent",
				name: "Agent",
				kind: "local_llm",
				isDoradsoft: false,
			},
			body: "Summary",
			at: "2026-11-15T00:00:00Z",
			revision: 1,
		} satisfies ContributionEvent;
		const events: ContributionEvent[] = [
			{
				...base,
				responses: [
					{
						commentId: "older-than-20",
						status: "addressed",
						body: "First response",
					},
				],
			},
			...Array.from({ length: 25 }, (_, index) => ({
				...base,
				id: String(index),
				kind: "comment" as const,
				body: `Original comment ${index}`,
			})),
			{
				...base,
				id: "later",
				responses: [
					{
						commentId: "older-than-20",
						status: "needs_input",
						body: "Please clarify",
					},
				],
			},
		];
		const before = structuredClone(events);
		const responses = latestAgentResponses(events);
		expect(events).toEqual(before);
		render(
			<AgentCommentResponse
				response={responses.get("older-than-20")}
				pending={false}
			/>,
		);
		expect(screen.getByText("נדרשת הבהרה")).toBeInTheDocument();
		expect(screen.getByText("Please clarify")).toBeInTheDocument();
	});
	it("shows addressed receipts and unresolved work without changing the original comment", () => {
		const { rerender, container } = render(
			<AgentCommentResponse pending={false} />,
		);
		expect(container).toBeEmptyDOMElement();
		rerender(<AgentCommentResponse pending />);
		expect(screen.getByText("ממתין להתייחסות הסוכן")).toBeInTheDocument();
		rerender(
			<AgentCommentResponse
				pending={false}
				response={{
					commentId: "comment",
					status: "addressed",
					body: "Corrected the proposed date",
				}}
			/>,
		);
		expect(screen.getByText("הסוכן התייחס להערה")).toBeInTheDocument();
	});
	it("ignores response fields attached to an ordinary comment", () => {
		const event: ContributionEvent = {
			id: "stray",
			kind: "comment",
			actor: item().author,
			body: "Original comment",
			at: "now",
			revision: 1,
			responses: [
				{
					commentId: "another",
					status: "addressed",
					body: "Not an agent receipt",
				},
			],
		};
		expect(latestAgentResponses([event]).size).toBe(0);
		const { container } = render(<AgentResponseLinks event={event} />);
		expect(container).toBeEmptyDOMElement();
	});
	it("links immutable response events back to both handled comments and clarification requests", () => {
		const event = {
			...item().author,
			id: "response",
			kind: "agent_response",
			actor: item().author,
			body: "Summary",
			at: "2026-11-15T00:00:00Z",
			revision: 2,
		} as ContributionEvent;
		const { rerender, container } = render(
			<AgentResponseLinks event={event} />,
		);
		expect(latestAgentResponses([event]).size).toBe(0);
		expect(container).toBeEmptyDOMElement();
		rerender(
			<AgentResponseLinks
				event={{
					...event,
					responses: [
						{ commentId: "one", status: "addressed", body: "Done" },
						{ commentId: "two", status: "needs_input", body: "Question" },
					],
				}}
			/>,
		);
		expect(
			screen.getByRole("link", { name: "התייחסות להערה" }),
		).toHaveAttribute("href", "#contribution-event-one");
		expect(
			screen.getByRole("link", { name: "בקשת הבהרה להערה" }),
		).toHaveAttribute("href", "#contribution-event-two");
	});
});
