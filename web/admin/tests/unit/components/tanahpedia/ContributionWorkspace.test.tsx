import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTION_API_VERSION } from "~/lib/tanahpedia/contribution-api";
import type { Contribution, Contributor } from "~/lib/tanahpedia/contributions";
import { contributionSnapshot } from "~/lib/tanahpedia/contributions";

const mocks = vi.hoisted(() => ({
	search: {} as Record<string, unknown>,
	navigate: vi.fn(),
	list: vi.fn(),
	session: vi.fn(),
	detail: vi.fn(),
	catalogue: vi.fn(),
	status: vi.fn(),
	agents: vi.fn(),
	create: vi.fn(),
	edit: vi.fn(),
	update: vi.fn(),
	merge: vi.fn(),
	recover: vi.fn(),
	generate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mocks.navigate,
	useSearch: () => mocks.search,
	Link: ({
		to,
		search,
		children,
		...props
	}: {
		to: string;
		search?: Record<string, unknown>;
		children: React.ReactNode;
	}) => (
		<a href={`${to}${search?.id ? `?id=${search.id}` : ""}`} {...props}>
			{children}
		</a>
	),
	createFileRoute: () => (config: unknown) => config,
}));
vi.mock("~/server/tanahpedia/contributions", () => ({
	getContributions: mocks.list,
	getContributionSession: mocks.session,
	getContribution: mocks.detail,
	getContributionCatalogue: mocks.catalogue,
	getContributionLlmStatus: mocks.status,
	getContributionAgents: mocks.agents,
	createContributionItem: mocks.create,
	editContributionItem: mocks.edit,
	updateContributionItem: mocks.update,
	mergeContributionItem: mocks.merge,
	recoverContributionItem: mocks.recover,
	generateIssuePrs: mocks.generate,
}));

import {
	ContributionWorkspace,
	validateContributionSearch,
} from "~/components/tanahpedia/ContributionWorkspace";
import { Route as IssueRoute } from "~/routes/issues";
import { Route as PrRoute } from "~/routes/pull-requests";

const ID = "00000000-0000-4000-8000-000000000001",
	PRID = "00000000-0000-4000-8000-000000000002";
const alice: Contributor = {
	id: "alice",
	name: "Alice",
	kind: "human",
	isDoradsoft: false,
};
const owner: Contributor = {
	id: "owner",
	name: "doradsoft",
	kind: "human",
	isDoradsoft: true,
};
function item(overrides: Partial<Contribution> = {}): Contribution {
	return {
		id: ID,
		number: 1,
		kind: "issue",
		state: "open",
		title: "בדיקת מקורות",
		description: "תיאור מפורט",
		author: alice,
		assignee: { kind: "unassigned" },
		evidence: [
			{
				citation: "בראשית א א",
				quote: "ציטוט",
				url: "https://example.com",
				note: "הסבר",
			},
		],
		changes: [],
		issueId: null,
		revision: 1,
		version: 1,
		apiVersion: CONTRIBUTION_API_VERSION,
		events: [
			{
				id: "event",
				kind: "created",
				actor: alice,
				body: "",
				at: "2026-11-14T12:00:00Z",
				revision: 1,
			},
		],
		createdAt: "2026-11-14T12:00:00Z",
		updatedAt: "2026-11-14T12:00:00Z",
		closeIssue: true,
		provenance: null,
		...overrides,
	};
}
let issue: Contribution, pr: Contribution, client: QueryClient;
function show(kind: "issue" | "pr" = "issue") {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ContributionWorkspace kind={kind} />
		</QueryClientProvider>,
	);
}

describe("issues and PR administration", () => {
	beforeEach(() => {
		mocks.search = {};
		for (const mock of [
			mocks.navigate,
			mocks.list,
			mocks.session,
			mocks.detail,
			mocks.catalogue,
			mocks.status,
			mocks.agents,
			mocks.create,
			mocks.edit,
			mocks.update,
			mocks.merge,
			mocks.recover,
			mocks.generate,
		])
			mock.mockReset();
		issue = item();
		pr = item({
			id: PRID,
			number: 2,
			kind: "pr",
			title: "שינוי שם",
			issueId: ID,
			changes: [
				{
					kind: "metadata",
					targetId: ID,
					before: { displayName: "ישן" },
					after: { displayName: "חדש" },
					labels: {},
				},
			],
		});
		mocks.list.mockImplementation(async ({ data }) => {
			const all = [issue, pr];
			const base = all.filter(
				(row) =>
					(!data.kind || row.kind === data.kind) &&
					(!data.assignee || row.assignee.kind === data.assignee) &&
					(!data.q ||
						`${row.title} ${row.description} ${row.number} ${row.author.name}`
							.toLowerCase()
							.includes(data.q.toLowerCase())),
			);
			return {
				items: base.filter(
					(row) =>
						!data.state ||
						data.state === "all" ||
						(data.state === "open"
							? row.state === "open"
							: row.state !== "open"),
				),
				nextCursor: null,
				counts: {
					issues: all.filter(
						(row) => row.kind === "issue" && row.state === "open",
					).length,
					prs: all.filter((row) => row.kind === "pr" && row.state === "open")
						.length,
					open: base.filter((row) => row.state === "open").length,
					closed: base.filter((row) => row.state !== "open").length,
					all: base.length,
				},
			};
		});
		mocks.session.mockResolvedValue(owner);
		mocks.detail.mockImplementation(async ({ data }) =>
			data === PRID ? pr : issue,
		);
		mocks.catalogue.mockResolvedValue({
			people: [],
			places: [],
			entities: [],
			targets: [],
		});
		mocks.status.mockResolvedValue({
			local: { enabled: true, model: "local" },
			aws: { enabled: true, model: "aws" },
		});
		mocks.create.mockResolvedValue(issue);
		mocks.edit.mockResolvedValue(issue);
		mocks.update.mockResolvedValue(issue);
		mocks.merge.mockResolvedValue({ ...pr, state: "merged" });
		mocks.navigate.mockResolvedValue(undefined);
		mocks.generate.mockResolvedValue([pr]);
		mocks.agents.mockResolvedValue([]);
	});
	afterEach(() => {
		client?.clear();
	});
	it("clears search and assignee filters without retaining empty URL values", async () => {
		mocks.search = { q: "term", assignee: "human" };
		show();
		fireEvent.change(await screen.findByLabelText("חיפוש דיונים"), {
			target: { value: "" },
		});
		fireEvent.change(screen.getByLabelText("סינון לפי אחראי"), {
			target: { value: "" },
		});
		expect(mocks.navigate).toHaveBeenCalledWith(
			expect.objectContaining({
				search: expect.objectContaining({ q: undefined }),
				replace: true,
			}),
		);
		expect(mocks.navigate).toHaveBeenCalledWith(
			expect.objectContaining({
				search: expect.objectContaining({ assignee: undefined }),
			}),
		);
	});
	it("keeps an unsent comment after a non-Error update failure", async () => {
		mocks.search = { id: ID };
		mocks.update.mockRejectedValue("disconnected");
		show();
		fireEvent.change(await screen.findByLabelText("הוספת תגובה"), {
			target: { value: "Retained comment" },
		});
		fireEvent.click(screen.getByRole("button", { name: "שליחת תגובה" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("העדכון נכשל");
		expect(screen.getByLabelText("הוספת תגובה")).toHaveValue(
			"Retained comment",
		);
	});
	it("shows migration history and raw sequences for a legacy proposal with no explicit API version", async () => {
		mocks.search = { id: PRID };
		pr.apiVersion = undefined;
		pr.apiMigrationHistory = [
			{
				id: "failed",
				status: "failed",
				from: 1,
				to: 2,
				at: pr.updatedAt,
				steps: [],
				error: "Retained migration failure",
				sequence: "Original sequence",
			},
			{
				id: "success",
				status: "succeeded",
				from: 2,
				to: 3,
				at: pr.updatedAt,
				steps: [],
				error: null,
				sequence: "Recovered sequence",
			},
		];
		show("pr");
		fireEvent.click(await screen.findByRole("tab", { name: "שינויים 1" }));
		expect(screen.getByText("Retained migration failure")).toBeInTheDocument();
		expect(screen.getByText("Original sequence")).toBeInTheDocument();
		expect(screen.getByText("Recovered sequence")).toBeInTheDocument();
	});
	it("never starts work from rendering or background reads", async () => {
		mocks.search = { id: ID };
		issue.assignee = { kind: "aws_llm" };
		show();
		expect(
			await screen.findByRole("button", { name: "הפעלה נוספת" }),
		).toBeEnabled();
		expect(mocks.generate).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
	});
	it("cancels a newly opened composer and returns to its queue", async () => {
		mocks.search = { id: "new" };
		show("pr");
		fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: "/pull-requests",
			search: {},
		});
	});
	it("navigates a newly saved PR to the PR discussion", async () => {
		mocks.search = { id: "new" };
		mocks.create.mockResolvedValue(pr);
		show("pr");
		fireEvent.change(await screen.findByLabelText("כותרת"), {
			target: { value: "Create entry" },
		});
		fireEvent.change(screen.getByLabelText("תיאור"), {
			target: { value: "Supported shell" },
		});
		fireEvent.change(screen.getByLabelText("סוג שינוי"), {
			target: { value: "entry" },
		});
		fireEvent.change(screen.getByLabelText("שם ייחודי"), {
			target: { value: "new-entry" },
		});
		fireEvent.change(screen.getAllByLabelText("כותרת")[1], {
			target: { value: "New entry" },
		});
		fireEvent.change(screen.getByLabelText("שם תצוגה"), {
			target: { value: "New person" },
		});
		fireEvent.click(screen.getByRole("button", { name: "פתיחת PR" }));
		await waitFor(() =>
			expect(mocks.navigate).toHaveBeenCalledWith({
				to: "/pull-requests",
				search: { id: PRID },
			}),
		);
	});
	it.each([
		["queued", null, "העבודה נמצאת בתור"],
		["running", new Date(Date.now() + 60000).toISOString(), "הסוכן מטפל בדיון"],
		["running", null, "ממתין לעובד זמין להמשך הטיפול"],
		["completed", null, "הסוכן סיים את העבודה"],
		["failed", null, "עבודת הסוכן נכשלה"],
		["cancelled", null, "עבודת הסוכן בוטלה"],
	])(
		"shows durable workstation generation state %s",
		async (status, leaseExpiresAt, label) => {
			mocks.search = { id: ID };
			issue.assignee = { kind: "local_llm" };
			issue.generation = {
				id: PRID,
				status: status as NonNullable<Contribution["generation"]>["status"],
				requestedAt: issue.createdAt,
				requestedBy: owner.id,
				attempts: 1,
				apiVersion: CONTRIBUTION_API_VERSION,
				worker: status === "queued" ? null : "Workstation",
				model: status === "completed" ? "local-model" : null,
				leaseHash: null,
				leaseExpiresAt,
				claimedVersion: null,
				contextHash: null,
				outputHash: null,
				prIds: status === "completed" ? [PRID] : [],
				error: status === "failed" ? "Invalid model output" : null,
			};
			show();
			expect(await screen.findByText(String(label))).toBeInTheDocument();
			if (status === "failed")
				expect(screen.getByRole("alert")).toHaveTextContent(
					"Invalid model output",
				);
			if (status === "completed")
				expect(screen.getByText("local-model")).toBeInTheDocument();
			if (status === "queued" || (status === "running" && leaseExpiresAt))
				expect(
					screen.getByRole("button", { name: "הפעלה נוספת" }),
				).toBeDisabled();
		},
	);
	it("shows content conflicts and AWS authorship while retaining the proposal for repair", async () => {
		mocks.search = { id: PRID };
		pr.domainConflict = "The cited fact changed";
		pr.author = {
			id: "aws:model",
			name: "AWS model",
			kind: "aws_llm",
			isDoradsoft: false,
		};
		show("pr");
		expect(
			await screen.findByText("The cited fact changed"),
		).toBeInTheDocument();
		expect(
			screen.getByText("AWS LLM", { selector: ".contribution-type" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "מיזוג PR" })).toBeDisabled();
	});
	it("retains stale review snapshots and the pending refresh marker after a content merge", async () => {
		mocks.search = { id: PRID };
		const snapshot = contributionSnapshot({ ...pr, apiVersion: undefined });
		pr.events.push({
			id: "old-review",
			kind: "approved",
			actor: owner,
			at: pr.updatedAt,
			revision: 1,
			body: "Reviewed previous proposal",
			snapshot,
		});
		pr.revision = 2;
		pr.state = "merged";
		pr.rebasePending = true;
		show("pr");
		expect(
			await screen.findByText(/רענון ההשוואות של ההצעות הממתינות נמצא בתור/),
		).toBeInTheDocument();
		expect(screen.getByText("Reviewed previous proposal")).toBeInTheDocument();
		expect(screen.getByText(/גרסה קודמת/)).toBeInTheDocument();
	});
	it("loads another keyset page and retains independently computed queue counts", async () => {
		mocks.list.mockImplementation(async ({ data }) => ({
			items: data.before
				? [{ ...issue, id: PRID, number: 1, title: "Older open issue" }]
				: [{ ...issue, number: 600 }],
			nextCursor: data.before ? null : 600,
			counts: { issues: 601, prs: 4, open: 601, closed: 2, all: 603 },
		}));
		show();
		fireEvent.click(
			await screen.findByRole("button", {
				name: "טעינת דיונים נוספים",
			}),
		);
		expect(await screen.findByText("Older open issue")).toBeInTheDocument();
		expect(mocks.list).toHaveBeenLastCalledWith({
			data: {
				kind: "issue",
				state: "open",
				q: undefined,
				assignee: undefined,
				before: 600,
			},
		});
		expect(
			screen.getByRole("link", { name: /Issues 601/ }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", {
				name: "טעינת דיונים נוספים",
			}),
		).not.toBeInTheDocument();
	});
	it("starts raw repair from the version current when editing opens after an assignment", async () => {
		pr.apiVersion = CONTRIBUTION_API_VERSION + 1;
		mocks.search = { id: PRID };
		mocks.detail.mockImplementation(async () => structuredClone(pr));
		mocks.update.mockImplementation(async () => {
			pr = { ...pr, version: 2 };
			return structuredClone(pr);
		});
		mocks.recover.mockResolvedValue(pr);
		show("pr");
		fireEvent.click(await screen.findByRole("tab", { name: "שינויים 1" }));
		fireEvent.click(screen.getByRole("button", { name: "שמירת שיוך" }));
		await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
		fireEvent.click(screen.getByRole("button", { name: "תיקון הרצף" }));
		fireEvent.click(screen.getByRole("button", { name: "שמירת רצף מתוקן" }));
		await waitFor(() =>
			expect(mocks.recover).toHaveBeenCalledWith({
				data: expect.objectContaining({ version: 2 }),
			}),
		);
	});
	it("exposes the description, evidence and raw operations of prior reviewed revisions", async () => {
		mocks.search = { id: PRID };
		pr.revisionHistory = [
			{
				revision: 1,
				version: 1,
				apiVersion: 1,
				author: alice,
				title: "Original proposal",
				description: "Original rationale",
				evidence: [
					{
						citation: "Original evidence",
						quote: "Original quote",
						url: null,
						note: "",
					},
				],
				changes: pr.changes,
				issueId: ID,
				closeIssue: true,
				at: pr.createdAt,
			},
		];
		show("pr");
		fireEvent.click(await screen.findByText("הצגת גרסה 1 - Alice"));
		expect(screen.getByText("Original rationale")).toBeInTheDocument();
		expect(screen.getByText("Original evidence")).toBeInTheDocument();
		expect(screen.getByText("Original quote")).toBeInTheDocument();
		expect(screen.getByText(/"displayName": "חדש"/)).toBeInTheDocument();
	});
	it("renders separate queues with creation and filtering controls", async () => {
		show();
		expect(await screen.findByText("בדיקת מקורות")).toBeInTheDocument();
		expect(screen.queryByText("שינוי שם")).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "+ פנייה חדשה" })).toHaveAttribute(
			"href",
			"/issues?id=new",
		);
		fireEvent.change(screen.getByLabelText("חיפוש דיונים"), {
			target: { value: "אברהם" },
		});
		expect(mocks.navigate).toHaveBeenCalledWith(
			expect.objectContaining({
				search: expect.objectContaining({ q: "אברהם" }),
				replace: true,
			}),
		);
		fireEvent.change(screen.getByLabelText("סינון לפי אחראי"), {
			target: { value: "aws_llm" },
		});
		expect(mocks.navigate).toHaveBeenCalledWith(
			expect.objectContaining({
				search: expect.objectContaining({ assignee: "aws_llm" }),
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: /סגורים/ }));
		expect(mocks.navigate).toHaveBeenCalledWith(
			expect.objectContaining({
				search: expect.objectContaining({ state: "closed" }),
			}),
		);
	});
	it("renders failed migrations gray and shows the original sequence instead of a visual diff", async () => {
		pr.author = owner;
		pr.apiVersion = CONTRIBUTION_API_VERSION + 1;
		pr.apiMigration = {
			status: "failed",
			id: "failed-migration",
			from: 2,
			to: 3,
			at: pr.updatedAt,
			steps: [],
			error: "Missing adapter",
			sequence: JSON.stringify(pr.changes),
		};
		mocks.search = { id: PRID };
		show("pr");
		expect(
			await screen.findByRole("button", { name: "מיזוג PR" }),
		).toBeDisabled();
		expect(screen.getByRole("button", { name: "עריכה" })).toBeDisabled();
		expect(
			screen.getAllByText("couldn't migrate to latest API").length,
		).toBeGreaterThan(0);
		fireEvent.click(screen.getByRole("tab", { name: "שינויים 1" }));
		expect(screen.getByText("רצף פעולות לשחזור ידני")).toBeInTheDocument();
		expect(screen.queryByRole("table")).not.toBeInTheDocument();
		expect(document.querySelector("pre")?.textContent).toContain(
			'"displayName": "חדש"',
		);
	});
	it("uses a gray queue row without interpreting an obsolete change kind", async () => {
		pr.apiVersion = CONTRIBUTION_API_VERSION + 1;
		show("pr");
		expect(
			await screen.findByText("couldn't migrate to latest API"),
		).toBeInTheDocument();
		expect(screen.getByText(pr.title).closest("article")).toHaveClass(
			"incompatible",
		);
	});
	it("keeps a raw repair draft on errors and submits a validated-current-version recovery", async () => {
		pr.apiVersion = CONTRIBUTION_API_VERSION + 1;
		mocks.search = { id: PRID };
		mocks.recover.mockRejectedValueOnce(new Error("Invalid operation"));
		show("pr");
		fireEvent.click(await screen.findByRole("tab", { name: "שינויים 1" }));
		fireEvent.click(screen.getByRole("button", { name: "תיקון הרצף" }));
		const field = screen.getByLabelText("רצף פעולות לשחזור");
		const raw = JSON.stringify(pr.changes);
		fireEvent.change(field, { target: { value: raw } });
		const form = field.closest("form");
		if (!form) throw new Error("Recovery form missing");
		fireEvent.submit(form);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Invalid operation",
		);
		expect(field).toHaveValue(raw);
		expect(mocks.recover).toHaveBeenCalledWith({
			data: {
				id: PRID,
				version: 1,
				apiVersion: CONTRIBUTION_API_VERSION,
				sequence: pr.changes,
			},
		});
	});
	it("explains migrated PRs whose obsolete operations were all removed", async () => {
		pr.author = owner;
		pr.changes = [];
		pr.apiMigration = {
			status: "succeeded",
			id: "successful-migration",
			from: 1,
			to: 1,
			at: pr.updatedAt,
			steps: [],
			error: null,
			sequence: "[]",
		};
		mocks.search = { id: PRID };
		show("pr");
		fireEvent.click(await screen.findByRole("tab", { name: "שינויים 0" }));
		expect(screen.getByText(/השדרוג הסיר פעולות/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "מיזוג PR" })).toBeEnabled();
	});
	it("filters by search and assignment while preserving deep-link search state", async () => {
		mocks.search = { q: "missing", assignee: "local_llm" };
		show();
		expect(
			await screen.findByText("לא נמצאו דיונים מתאימים"),
		).toBeInTheDocument();
	});
	it("shows closed and merged items under the closed filter", async () => {
		mocks.search = { state: "closed" };
		pr.state = "merged";
		show("pr");
		expect(await screen.findByText("שינוי שם")).toBeInTheDocument();
	});
	it("has informative empty states for both queues", async () => {
		mocks.list.mockResolvedValue({
			items: [],
			nextCursor: null,
			counts: { issues: 0, prs: 0, open: 0, closed: 0, all: 0 },
		});
		show("pr");
		expect(await screen.findByText("השינוי הבא מתחיל כאן")).toBeInTheDocument();
	});
	it("shows request errors and supports refreshing", async () => {
		mocks.list.mockRejectedValue(new Error("Database unavailable"));
		show();
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Database unavailable",
		);
		fireEvent.click(screen.getByRole("button", { name: "ניסיון נוסף" }));
		await waitFor(() =>
			expect(mocks.list.mock.calls.length).toBeGreaterThan(1),
		);
	});
	it("renders description, evidence, timeline and linked PRs", async () => {
		mocks.search = { id: ID };
		issue.events.push({
			id: "comment",
			kind: "comment",
			actor: owner,
			body: "הערה חשובה",
			at: issue.createdAt,
			revision: 1,
		});
		show();
		expect(await screen.findByText("תיאור מפורט")).toBeInTheDocument();
		expect(screen.getByText("הערה חשובה")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "פתיחת המקור ↗" })).toHaveAttribute(
			"href",
			"https://example.com",
		);
		expect(
			screen.getByRole("link", { name: /#2 שינוי שם/ }),
		).toBeInTheDocument();
	});
	it("submits comments and explicit assignment changes", async () => {
		mocks.search = { id: ID };
		show();
		await screen.findByText("תיאור מפורט");
		fireEvent.change(screen.getByLabelText("הוספת תגובה"), {
			target: { value: "מידע חדש" },
		});
		fireEvent.click(screen.getByRole("button", { name: "שליחת תגובה" }));
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith({
				data: expect.objectContaining({
					id: ID,
					action: "comment",
					body: "מידע חדש",
				}),
			}),
		);
		fireEvent.change(screen.getByLabelText("אחראי", { exact: true }), {
			target: { value: "aws_llm" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "שמירת שיוך והפעלת סוכן" }),
		);
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith({
				data: expect.objectContaining({
					action: "assign",
					assignee: { kind: "aws_llm" },
				}),
			}),
		);
	});
	it("shows rejected mutations with the server's actionable reason", async () => {
		mocks.search = { id: ID };
		mocks.update.mockRejectedValue(new Error("Reload before retrying"));
		show();
		await screen.findByText("תיאור מפורט");
		fireEvent.click(screen.getByRole("button", { name: "סגירה ללא מיזוג" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Reload before retrying",
		);
	});
	it("opens the typed changes tab and requires owner approval before merging", async () => {
		mocks.search = { id: PRID };
		show("pr");
		await screen.findByText("תיאור מפורט");
		expect(screen.getByRole("button", { name: "מיזוג PR" })).toBeDisabled();
		fireEvent.click(screen.getByRole("tab", { name: /שינויים/ }));
		expect(screen.getByText("ישן")).toBeInTheDocument();
		expect(screen.getByText("חדש")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "אישור השינויים" }));
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith({
				data: expect.objectContaining({ action: "approve" }),
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "בקשת שינויים" }));
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith({
				data: expect.objectContaining({ action: "request_changes" }),
			}),
		);
	});
	it("merges a doradsoft-authored PR without asking for another review", async () => {
		mocks.search = { id: PRID };
		pr.author = owner;
		show("pr");
		await screen.findByText("תיאור מפורט");
		expect(
			screen.queryByRole("button", { name: "אישור השינויים" }),
		).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "מיזוג PR" }));
		await waitFor(() =>
			expect(mocks.merge).toHaveBeenCalledWith({
				data: expect.objectContaining({ id: PRID, version: 1 }),
			}),
		);
	});
	it.each([
		["queued", null],
		["running", "2099-01-01T00:00:00Z"],
		["running", "2000-01-01T00:00:00Z"],
	] as const)(
		"blocks an approved PR while the assigned agent pass is %s even if its lease expired",
		async (status, leaseExpiresAt) => {
			mocks.search = { id: PRID };
			pr.assignee = { kind: "local_llm" };
			pr.events.push({
				id: "approval",
				kind: "approved",
				actor: owner,
				body: "Approved",
				at: pr.createdAt,
				revision: 1,
			});
			pr.generation = {
				id: "job",
				status,
				leaseExpiresAt,
				requestedAt: pr.createdAt,
				requestedBy: owner.id,
				attempts: 1,
				apiVersion: CONTRIBUTION_API_VERSION,
				worker: null,
				model: null,
				leaseHash: null,
				claimedVersion: null,
				contextHash: null,
				outputHash: null,
				prIds: [],
				error: null,
			};
			show("pr");
			expect(
				await screen.findByRole("heading", {
					name: "ממתין לסיום הטיפול של הסוכן",
				}),
			).toBeInTheDocument();
			const merge = screen.getByRole("button", { name: "מיזוג PR" });
			expect(merge).toBeDisabled();
			expect(merge.closest("section")).not.toHaveClass("ready");
			const rerun = screen.getByRole("button", { name: "הפעלה נוספת" });
			if (leaseExpiresAt?.startsWith("2000")) expect(rerun).toBeEnabled();
			else expect(rerun).toBeDisabled();
		},
	);
	it("hides owner approval actions from other editors", async () => {
		mocks.search = { id: PRID };
		mocks.session.mockResolvedValue(alice);
		show("pr");
		await screen.findByText("תיאור מפורט");
		expect(
			screen.queryByRole("button", { name: "אישור השינויים" }),
		).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "מיזוג PR" })).toBeDisabled();
	});
	it.each(["local_llm", "aws_llm"] as const)(
		"offers a secondary rerun for the persisted %s assignment",
		async (kind) => {
			mocks.search = { id: ID };
			issue.assignee = { kind };
			show();
			fireEvent.click(
				await screen.findByRole("button", { name: "הפעלה נוספת" }),
			);
			await waitFor(() =>
				expect(mocks.update).toHaveBeenCalledWith({
					data: expect.objectContaining({
						id: ID,
						version: 1,
						action: "run_agent",
					}),
				}),
			);
			expect(mocks.generate).not.toHaveBeenCalled();
		},
	);
	it("keeps evidence and manual proposal creation available to an assigned issue", async () => {
		mocks.search = { id: ID };
		issue.evidence = [];
		issue.assignee = { kind: "aws_llm" };
		show();
		expect(await screen.findByText(/טרם נוספו מקורות/)).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "פתיחת PR ידנית" }),
		).toHaveAttribute("href", "/pull-requests?id=new");
		expect(
			screen.queryByRole("button", { name: "יצירת PRs עם AWS LLM" }),
		).not.toBeInTheDocument();
	});
	it("shows immutable comment-resolution receipts on a PR and keeps owner review required", async () => {
		mocks.search = { id: PRID };
		pr.assignee = { kind: "aws_llm" };
		pr.events.push(
			{
				id: "human-comment",
				kind: "comment",
				actor: alice,
				body: "Keep this original request",
				at: pr.createdAt,
				revision: 1,
			},
			{
				id: "response",
				kind: "agent_response",
				actor: { ...alice, kind: "aws_llm", name: "Agent" },
				body: "Updated proposal",
				at: pr.createdAt,
				revision: 2,
				responses: [
					{
						commentId: "human-comment",
						status: "addressed",
						body: "Corrected the date in the proposal",
					},
				],
				run: {
					jobId: "job",
					agentId: "agent",
					bundleVersion: "v2",
					model: "model",
				},
			},
		);
		show("pr");
		expect(
			await screen.findByText("Keep this original request"),
		).toBeInTheDocument();
		expect(
			screen.getByText("Corrected the date in the proposal"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "התייחסות להערה" }),
		).toHaveAttribute("href", "#contribution-event-human-comment");
		expect(screen.getByRole("button", { name: "מיזוג PR" })).toBeDisabled();
		expect(screen.getByText(/תגובה חדשה תפעיל/)).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("הוספת תגובה"), {
			target: { value: "Please check another source" },
		});
		fireEvent.click(screen.getByRole("button", { name: "שליחת תגובה" }));
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith({
				data: expect.objectContaining({
					action: "comment",
					body: "Please check another source",
				}),
			}),
		);
		expect(mocks.generate).not.toHaveBeenCalled();
	});
	it("renders closed discussions and allows reopening", async () => {
		mocks.search = { id: ID };
		issue.state = "closed";
		show();
		await screen.findByText("תיאור מפורט");
		fireEvent.click(screen.getByRole("button", { name: "פתיחה מחדש" }));
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith({
				data: expect.objectContaining({ action: "reopen" }),
			}),
		);
	});
	it("displays merged PRs and provenance without merge controls", async () => {
		mocks.search = { id: PRID };
		pr.state = "merged";
		pr.author = { ...alice, kind: "local_llm", name: "model" };
		pr.provenance = {
			model: "qwen",
			provider: "local_llm",
			promptVersion: "v1",
		};
		show("pr");
		expect(await screen.findByText("ההצעה מוזגה בהצלחה")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "מיזוג PR" }),
		).not.toBeInTheDocument();
		expect(screen.getByText("qwen")).toBeInTheDocument();
	});
	it("creates an issue from the linked form and navigates to its detail", async () => {
		mocks.search = { id: "new" };
		show();
		await screen.findByRole("form");
		fireEvent.change(screen.getByLabelText("כותרת"), {
			target: { value: "חדש" },
		});
		fireEvent.change(screen.getByLabelText("תיאור"), {
			target: { value: "תיאור חדש" },
		});
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() => expect(mocks.create).toHaveBeenCalled());
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: "/issues",
			search: { id: ID },
		});
	});
	it("edits an issue using its current optimistic version", async () => {
		mocks.search = { id: ID };
		show();
		fireEvent.click(await screen.findByRole("button", { name: "עריכה" }));
		await screen.findByRole("form");
		fireEvent.change(screen.getByLabelText("כותרת"), {
			target: { value: "מעודכן" },
		});
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(mocks.edit).toHaveBeenCalledWith({
				data: expect.objectContaining({ id: ID, version: 1, title: "מעודכן" }),
			}),
		);
	});
	it("preserves an unsent comment across a background issue refresh", async () => {
		mocks.search = { id: ID };
		show();
		const field = await screen.findByLabelText("הוספת תגובה");
		fireEvent.change(field, { target: { value: "טיוטה שלא נשלחה" } });
		issue = { ...issue, version: 2 };
		await client.invalidateQueries({ queryKey: ["contribution", ID] });
		await waitFor(() =>
			expect(mocks.detail.mock.calls.length).toBeGreaterThan(1),
		);
		expect(screen.getByLabelText("הוספת תגובה")).toHaveValue("טיוטה שלא נשלחה");
	});
	it("waits for the linked issue before initializing a manual PR's title and evidence", async () => {
		mocks.search = { id: "new", issueId: ID };
		let finish: (value: Contribution) => void = () => {};
		mocks.detail.mockReturnValue(
			new Promise<Contribution>((resolve) => {
				finish = resolve;
			}),
		);
		show("pr");
		expect(await screen.findByText("טוען נתונים לטופס...")).toBeInTheDocument();
		expect(screen.queryByRole("form")).not.toBeInTheDocument();
		await waitFor(() => expect(mocks.catalogue).toHaveBeenCalled());
		finish(issue);
		expect(await screen.findByLabelText("כותרת")).toHaveValue(issue.title);
		expect(screen.getByLabelText("הפניה למקור")).toHaveValue("בראשית א א");
		expect(screen.getByLabelText("ציטוט רלוונטי")).toHaveValue("ציטוט");
		fireEvent.change(screen.getByLabelText("כותרת"), {
			target: { value: "My manual draft" },
		});
		issue = { ...issue, version: 2, title: "Another editor's issue title" };
		mocks.detail.mockResolvedValue(issue);
		await client.invalidateQueries({ queryKey: ["contribution", ID] });
		expect(screen.getByLabelText("כותרת")).toHaveValue("My manual draft");
	});
	it("exposes a linked-issue failure and retries without opening a contextless composer", async () => {
		mocks.search = { id: "new", issueId: ID };
		mocks.detail
			.mockRejectedValueOnce(new Error("Linked issue unavailable"))
			.mockResolvedValue(issue);
		show("pr");
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Linked issue unavailable",
		);
		expect(screen.queryByRole("form")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "ניסיון נוסף" }));
		expect(await screen.findByLabelText("כותרת")).toHaveValue(issue.title);
		expect(screen.getByLabelText("הפניה למקור")).toHaveValue("בראשית א א");
	});
	it("preserves a dirty assignment and its base version through a concurrent assignment update", async () => {
		mocks.search = { id: ID };
		show();
		fireEvent.change(await screen.findByLabelText("אחראי", { exact: true }), {
			target: { value: "human" },
		});
		fireEvent.change(screen.getByLabelText("שם משתמש אחראי"), {
			target: { value: "My unsaved editor" },
		});
		issue = { ...issue, version: 2, assignee: { kind: "local_llm" } };
		await client.invalidateQueries({ queryKey: ["contribution", ID] });
		expect(
			await screen.findByText(/הדיון עודכן מאז עריכת השיוך/),
		).toBeInTheDocument();
		expect(screen.getByLabelText("אחראי", { exact: true })).toHaveValue(
			"human",
		);
		expect(screen.getByLabelText("שם משתמש אחראי")).toHaveValue(
			"My unsaved editor",
		);
		const save = screen.getByRole("button", { name: "שמירת שיוך" });
		expect(save).toBeDisabled();
		fireEvent.submit(save.closest("form") as HTMLFormElement);
		expect(mocks.update).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "טעינת השיוך העדכני" }));
		expect(screen.getByLabelText("אחראי", { exact: true })).toHaveValue(
			"local_llm",
		);
		fireEvent.change(screen.getByLabelText("אחראי", { exact: true }), {
			target: { value: "aws_llm" },
		});
		mocks.update.mockImplementation(async ({ data }) => {
			issue = { ...issue, version: 3, assignee: data.assignee };
			return issue;
		});
		fireEvent.click(
			screen.getByRole("button", { name: "שמירת שיוך והפעלת סוכן" }),
		);
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith({
				data: {
					id: ID,
					version: 2,
					action: "assign",
					assignee: { kind: "aws_llm" },
				},
			}),
		);
		await waitFor(() =>
			expect(
				screen.queryByText(/הדיון עודכן מאז עריכת השיוך/),
			).not.toBeInTheDocument(),
		);
	});
	it("follows a refreshed assignment when untouched and keeps a rejected draft when edited", async () => {
		mocks.search = { id: ID };
		show();
		await screen.findByLabelText("אחראי", { exact: true });
		issue = { ...issue, version: 2, assignee: { kind: "local_llm" } };
		await client.invalidateQueries({ queryKey: ["contribution", ID] });
		await waitFor(() =>
			expect(screen.getByLabelText("אחראי", { exact: true })).toHaveValue(
				"local_llm",
			),
		);
		expect(
			screen.queryByText(/הדיון עודכן מאז עריכת השיוך/),
		).not.toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("אחראי", { exact: true }), {
			target: { value: "human" },
		});
		fireEvent.change(screen.getByLabelText("שם משתמש אחראי"), {
			target: { value: "Keep this draft" },
		});
		mocks.update.mockRejectedValue(new Error("The saved version changed"));
		fireEvent.click(screen.getByRole("button", { name: "שמירת שיוך" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"The saved version changed",
		);
		expect(screen.getByLabelText("שם משתמש אחראי")).toHaveValue(
			"Keep this draft",
		);
		expect(mocks.update).toHaveBeenCalledWith({
			data: expect.objectContaining({ version: 2 }),
		});
	});
	it("retains a comment typed while an earlier comment is being submitted", async () => {
		let complete: (value: Contribution) => void = () => {};
		mocks.update.mockImplementation(
			() =>
				new Promise<Contribution>((resolve) => {
					complete = resolve;
				}),
		);
		mocks.search = { id: ID };
		show();
		const field = await screen.findByLabelText("הוספת תגובה");
		fireEvent.change(field, { target: { value: "תגובה ראשונה" } });
		fireEvent.click(screen.getByRole("button", { name: "שליחת תגובה" }));
		await waitFor(() => expect(mocks.update).toHaveBeenCalled());
		fireEvent.change(field, { target: { value: "תגובה חדשה" } });
		complete(issue);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "שליחת תגובה" })).toBeEnabled(),
		);
		expect(screen.getByLabelText("הוספת תגובה")).toHaveValue("תגובה חדשה");
	});
	it("submits edits against the snapshot opened by the editor despite a background update", async () => {
		mocks.search = { id: ID };
		show();
		fireEvent.click(await screen.findByRole("button", { name: "עריכה" }));
		await screen.findByRole("form");
		fireEvent.change(screen.getByLabelText("כותרת"), {
			target: { value: "טיוטה שלי" },
		});
		issue = { ...issue, version: 2, title: "שינוי של עורך אחר" };
		await client.invalidateQueries({ queryKey: ["contribution", ID] });
		expect(screen.getByLabelText("כותרת")).toHaveValue("טיוטה שלי");
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(mocks.edit).toHaveBeenCalledWith({
				data: expect.objectContaining({
					id: ID,
					version: 1,
					title: "טיוטה שלי",
				}),
			}),
		);
	});
	it("cancels creation and returns to the matching queue", async () => {
		mocks.search = { id: "new", issueId: ID };
		show("pr");
		fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: "/pull-requests",
			search: {},
		});
	});
	it("validates deep-link and filter state and exposes both routes", () => {
		expect(
			validateContributionSearch({
				id: "not-an-id",
				issueId: 2,
				q: 9,
				state: "bad",
			}),
		).toMatchObject({
			id: undefined,
			issueId: undefined,
			q: undefined,
			state: "open",
		});
		expect(
			validateContributionSearch({
				id: "new",
				issueId: ID,
				q: "a".repeat(600),
				state: "all",
				assignee: "human",
			}),
		).toMatchObject({
			id: "new",
			issueId: ID,
			state: "all",
			assignee: "human",
		});
		expect(validateContributionSearch({ q: "a".repeat(600) }).q).toHaveLength(
			500,
		);
		for (const route of [IssueRoute, PrRoute])
			expect(
				(route as unknown as { component: () => unknown }).component(),
			).toBeTruthy();
	});
});
