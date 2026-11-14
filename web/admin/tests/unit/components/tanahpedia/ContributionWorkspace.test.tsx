import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Contribution, Contributor } from "~/lib/tanahpedia/contributions";

const mocks = vi.hoisted(() => ({
	search: {} as Record<string, unknown>,
	navigate: vi.fn(),
	list: vi.fn(),
	session: vi.fn(),
	detail: vi.fn(),
	catalogue: vi.fn(),
	status: vi.fn(),
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
	});
	afterEach(() => {
		client?.clear();
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
		pr.apiVersion = 2;
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
		pr.apiVersion = 2;
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
		pr.apiVersion = 2;
		show("pr");
		expect(
			await screen.findByText("couldn't migrate to latest API"),
		).toBeInTheDocument();
		expect(screen.getByText(pr.title).closest("article")).toHaveClass(
			"incompatible",
		);
	});
	it("keeps a raw repair draft on errors and submits a validated-current-version recovery", async () => {
		pr.apiVersion = 2;
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
			data: { id: PRID, version: 1, apiVersion: 1, sequence: pr.changes },
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
		fireEvent.click(screen.getByRole("button", { name: "שמירת שיוך" }));
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
	it("generates PRs only through the persisted LLM assignee", async () => {
		mocks.search = { id: ID };
		issue.assignee = { kind: "aws_llm" };
		show();
		const button = await screen.findByRole("button", {
			name: "יצירת PRs עם AWS LLM",
		});
		await waitFor(() => expect(button).toBeEnabled());
		fireEvent.click(button);
		await waitFor(() =>
			expect(mocks.generate).toHaveBeenCalledWith({
				data: { id: ID, version: 1 },
			}),
		);
		expect(await screen.findByRole("status")).toHaveTextContent("נוצרו 1");
	});
	it("queues workstation generation without invoking a server-side model", async () => {
		mocks.search = { id: ID };
		issue.assignee = { kind: "local_llm" };
		show();
		fireEvent.click(
			await screen.findByRole("button", { name: "שליחה לעובד מקומי" }),
		);
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith({
				data: expect.objectContaining({
					id: ID,
					version: 1,
					action: "queue_generation",
				}),
			}),
		);
		expect(mocks.generate).not.toHaveBeenCalled();
	});
	it("reports provider failures and unconfigured providers", async () => {
		mocks.search = { id: ID };
		issue.assignee = { kind: "aws_llm" };
		mocks.status.mockResolvedValue({
			local: { enabled: false },
			aws: { enabled: false },
		});
		show();
		expect(
			await screen.findByText("הספק שנבחר עדיין לא מוגדר בשרת."),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "יצירת PRs עם AWS LLM" }),
		).toBeDisabled();
	});
	it("shows model errors without pretending PRs were generated", async () => {
		mocks.search = { id: ID };
		issue.assignee = { kind: "aws_llm" };
		mocks.generate.mockRejectedValue(new Error("Invalid model output"));
		show();
		const button = await screen.findByRole("button", {
			name: "יצירת PRs עם AWS LLM",
		});
		await waitFor(() => expect(button).toBeEnabled());
		fireEvent.click(button);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Invalid model output",
		);
	});
	it("requires evidence before generation and exposes human PR creation", async () => {
		mocks.search = { id: ID };
		issue.evidence = [];
		issue.assignee = { kind: "aws_llm" };
		show();
		expect(await screen.findByText(/טרם נוספו מקורות/)).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "יצירת PRs עם AWS LLM" }),
		).toBeDisabled();
		expect(
			screen.getByRole("link", { name: "פתיחת PR ידנית" }),
		).toHaveAttribute("href", "/pull-requests?id=new");
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
