import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	AssigneePicker,
	type ContributionCatalogue,
	ContributionComposer,
} from "~/components/tanahpedia/ContributionComposer";
import type { ContributionAgentSummary } from "~/lib/tanahpedia/contribution-agents";
import type { Contribution } from "~/lib/tanahpedia/contributions";
import {
	FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES,
	FAMILY_UNION_TYPES,
} from "~/server/tanahpedia/family-api-spec";

const ID = "00000000-0000-4000-8000-000000000001",
	OTHER = "00000000-0000-4000-8000-000000000002";

it.each([
	...FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES.map((type) => [
		"parent_child",
		type,
	]),
	...FAMILY_UNION_TYPES.map((type) => ["union", type]),
])(
	"offers and submits the defined family relationship %s:%s",
	async (kind, type) => {
		const { submit } = setup("pr");
		description();
		expect(screen.getByLabelText("סוג שינוי")).toHaveValue("family");
		const relation = screen.getByLabelText("סוג קשר משפחתי");
		expect(relation.querySelectorAll("option")).toHaveLength(
			FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES.length + FAMILY_UNION_TYPES.length,
		);
		fireEvent.change(relation, { target: { value: `${kind}:${type}` } });
		fireEvent.change(
			screen.getByLabelText(kind === "parent_child" ? "הורה" : "איש ראשון"),
			{ target: { value: ID } },
		);
		fireEvent.change(
			screen.getByLabelText(kind === "parent_child" ? "ילד" : "איש שני"),
			{ target: { value: OTHER } },
		);
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				expect.objectContaining({
					changes: [
						expect.objectContaining({
							kind,
							after: expect.objectContaining({
								[kind === "parent_child" ? "relationshipType" : "unionType"]:
									type,
							}),
						}),
					],
				}),
			),
		);
	},
);
const catalogue: ContributionCatalogue = {
	people: [
		{ id: ID, name: "אברהם" },
		{ id: OTHER, name: "יצחק" },
	],
	places: [{ id: ID, name: "ירושלים" }],
	entities: [{ id: ID, name: "אברהם", entityType: "PERSON" }],
	targets: [
		{
			id: OTHER,
			kind: "parent_child",
			label: "אברהם → יצחק",
			after: {
				parentId: ID,
				childId: OTHER,
				relationshipType: "BIOLOGICAL",
				parentRole: "FATHER",
				sourceCitation: null,
				altGroupId: null,
				birthOrder: 2,
			},
		},
	],
};
function setup(kind: "issue" | "pr" = "issue", extras = {}) {
	const submit = vi.fn().mockResolvedValue(undefined),
		cancel = vi.fn();
	render(
		<ContributionComposer
			kind={kind}
			catalogue={catalogue}
			busy={false}
			onSubmit={submit}
			onCancel={cancel}
			{...extras}
		/>,
	);
	return { submit, cancel };
}
function description() {
	fireEvent.change(screen.getByLabelText("כותרת"), {
		target: { value: "כותרת לבדיקה" },
	});
	fireEvent.change(screen.getByLabelText("תיאור"), {
		target: { value: "תיאור מבוסס ראיות" },
	});
}

describe("contribution composer", () => {
	it("round-trips a place proposal and removes only the selected word anchor", async () => {
		const occurrence = {
			perekId: 67,
			pasukNumber: 7,
			segmentStart: 3,
			segmentEnd: 3,
			text: "מַסָּ֖ה",
		};
		const other = {
			...occurrence,
			segmentStart: 4,
			segmentEnd: 4,
			text: "וּמְרִיבָ֑ה",
		};
		const after = {
			entry: {
				title: "מסה ומריבה",
				uniqueName: "מסה ומריבה",
				displayName: "מסה ומריבה",
			},
			occurrences: [occurrence, other],
			identification: {
				modernName: "אתר לבדיקה",
				basis: "commentary",
				latitude: 30.1,
				longitude: 32.2,
				citation: "זיהוי מהפירוש",
				coordinateCitation: "מפת מדידה",
			},
		};
		const initial = {
			kind: "pr",
			title: "מופעים במקרא",
			description: "תיאור",
			assignee: { kind: "unassigned" },
			evidence: [],
			issueId: OTHER,
			closeIssue: true,
			changes: [
				{
					kind: "place_profile",
					targetId: ID,
					before: null,
					after,
					labels: { "67:7:3:3": "שמות יז ז", "67:7:4:4": "שמות יז ז" },
				},
			],
		} as unknown as Contribution;
		const { submit } = setup("pr", { initial });
		expect(screen.getByLabelText("סוג שינוי")).toHaveValue("place_profile");
		expect(
			screen.getByLabelText("סגירת הפנייה המקושרת לאחר מיזוג"),
		).toBeChecked();
		expect(screen.getByLabelText("כותרת הערך")).toHaveValue("מסה ומריבה");
		expect(screen.getByLabelText("בסיס הזיהוי")).toHaveValue("commentary");
		expect(screen.getByLabelText("מקור לקואורדינטות")).toHaveValue("מפת מדידה");
		expect(
			screen.getByRole("button", { name: "+ הוספת שינוי" }),
		).toBeDisabled();
		fireEvent.click(screen.getByText("1. מַסָּ֖ה - שמות יז ז"));
		fireEvent.click(screen.getByText("הסרת מופע 1"));
		fireEvent.change(screen.getByLabelText("קו אורך"), {
			target: { value: "32.25" },
		});
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				expect.objectContaining({
					issueId: OTHER,
					closeIssue: true,
					changes: [
						{
							kind: "place_profile",
							targetId: ID,
							after: {
								...after,
								occurrences: [other],
								identification: { ...after.identification, longitude: 32.25 },
							},
						},
					],
				}),
			),
		);
	});

	it("defaults a place PR from a free-form issue to staying open and keeps an explicit choice", () => {
		const linkedIssue = {
			id: OTHER,
			kind: "issue",
			evidence: [],
		} as unknown as Contribution;
		setup("pr", { linkedIssue });
		const changeKind = screen.getByLabelText("סוג שינוי");
		const closeIssue = screen.getByLabelText("סגירת הפנייה המקושרת לאחר מיזוג");

		expect(closeIssue).toBeChecked();
		fireEvent.change(changeKind, { target: { value: "place_profile" } });
		expect(closeIssue).not.toBeChecked();
		fireEvent.change(changeKind, { target: { value: "family" } });
		expect(closeIssue).toBeChecked();
		fireEvent.change(changeKind, { target: { value: "place_profile" } });

		fireEvent.click(closeIssue);
		fireEvent.change(changeKind, { target: { value: "family" } });
		fireEvent.change(changeKind, { target: { value: "place_profile" } });
		expect(closeIssue).toBeChecked();

		fireEvent.click(closeIssue);
		fireEvent.change(changeKind, { target: { value: "family" } });
		expect(closeIssue).not.toBeChecked();
	});

	it("starts a linked place PR in place mode without closing its discovery issue", async () => {
		const linkedIssue = {
			id: OTHER,
			kind: "issue",
			scope: { kind: "place_profile" },
			evidence: [],
		} as unknown as Contribution;
		const { submit } = setup("pr", { linkedIssue });
		description();
		expect(screen.getByLabelText("סוג שינוי")).toHaveValue("place_profile");
		expect(
			screen.getByLabelText("סגירת הפנייה המקושרת לאחר מיזוג"),
		).not.toBeChecked();
		fireEvent.change(screen.getByLabelText("יעד ההצעה"), {
			target: { value: "existing" },
		});
		fireEvent.change(screen.getByLabelText("מקום קיים"), {
			target: { value: ID },
		});
		fireEvent.click(screen.getByRole("button", { name: "+ הוספת מופע" }));
		for (const [label, value] of [
			["מזהה פרק", "67"],
			["מספר פסוק", "7"],
			["קטע ראשון", "0"],
			["קטע אחרון", "1"],
			["מילה או צירוף מהמקרא", "צירוף מדויק"],
		]) {
			fireEvent.change(screen.getByLabelText(label), { target: { value } });
		}
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				expect.objectContaining({
					issueId: OTHER,
					closeIssue: false,
					changes: [
						{
							kind: "place_profile",
							targetId: ID,
							after: {
								entry: null,
								occurrences: [
									{
										perekId: 67,
										pasukNumber: 7,
										segmentStart: 0,
										segmentEnd: 1,
										text: "צירוף מדויק",
									},
								],
								identification: null,
							},
						},
					],
				}),
			),
		);
	});

	it("submits optional article scope separately from the issue's free text", async () => {
		const { submit } = setup();
		description();
		fireEvent.change(screen.getByLabelText("סוג השינוי המבוקש"), {
			target: { value: "article_links" },
		});
		fireEvent.change(screen.getByLabelText("מספר מאמר (רשות)"), {
			target: { value: "123" },
		});
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				expect.objectContaining({
					description: "תיאור מבוסס ראיות",
					scope: { kind: "article_links", targetId: "123" },
					changes: [],
				}),
			),
		);
	});
	it("retains an existing scope while editing and explicitly clears it when requested", async () => {
		const initial = {
			kind: "issue",
			title: "Existing issue",
			description: "Existing context",
			assignee: { kind: "unassigned" },
			evidence: [],
			changes: [],
			scope: { kind: "article_links", targetId: "123" },
		} as unknown as Contribution;
		const { submit } = setup("issue", { initial });
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenLastCalledWith(
				expect.objectContaining({ scope: initial.scope }),
			),
		);
		fireEvent.change(screen.getByLabelText("סוג השינוי המבוקש"), {
			target: { value: "" },
		});
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenLastCalledWith(
				expect.objectContaining({ scope: null }),
			),
		);
	});
	it("keeps issue scope controls out of manual PR composition", () => {
		setup("pr");
		expect(screen.queryByText("הכוונה לסוכן (רשות)")).not.toBeInTheDocument();
	});
	it("retains structured evidence on note edits and drops stale offsets when its quote changes", async () => {
		const articleSource = {
			articleId: "17",
			contentHash: "a".repeat(32),
			sourceHash: "b".repeat(64),
			spanStart: 2,
			spanEnd: 7,
		};
		const initial = {
			id: ID,
			kind: "issue",
			title: "מקור",
			description: "תיאור",
			assignee: { kind: "unassigned" },
			evidence: [
				{
					citation: "מאמר 17",
					quote: "מקור ",
					note: "",
					url: null,
					articleSource,
				},
			],
			changes: [],
			issueId: null,
			closeIssue: true,
		} as unknown as Contribution;
		const { submit } = setup("issue", { initial });
		fireEvent.change(screen.getByLabelText("מה המקור מוכיח?"), {
			target: { value: "הסבר מעודכן" },
		});
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				expect.objectContaining({
					evidence: [
						expect.objectContaining({ quote: "מקור ", articleSource }),
					],
				}),
			),
		);
		submit.mockClear();
		fireEvent.change(screen.getByLabelText("ציטוט רלוונטי"), {
			target: { value: "ציטוט אחר" },
		});
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				expect.objectContaining({
					evidence: [
						expect.objectContaining({
							quote: "ציטוט אחר",
							articleSource: undefined,
						}),
					],
				}),
			),
		);
		expect(initial.evidence[0].articleSource).toEqual(articleSource);
	});
	it("submits article links as an ordinary typed PR without converting numeric IDs to encyclopedia UUIDs", async () => {
		const { submit } = setup("pr");
		description();
		fireEvent.change(screen.getByLabelText("סוג שינוי"), {
			target: { value: "article_links" },
		});
		fireEvent.change(screen.getByLabelText("מספר מאמר"), {
			target: { value: "17" },
		});
		fireEvent.click(screen.getByRole("button", { name: "+ הוספת קישור מוצע" }));
		fireEvent.change(screen.getByLabelText("פרק בקישור 1 פסוק 1"), {
			target: { value: "1" },
		});
		fireEvent.change(screen.getByLabelText("מספר פסוק בקישור 1 פסוק 1"), {
			target: { value: "2" },
		});
		expect(
			screen.getByRole("button", { name: "+ הוספת שינוי" }),
		).toBeDisabled();
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "pr",
					changes: [
						{
							kind: "article_links",
							targetId: "17",
							after: {
								commands: [
									{
										relationshipKey: "coveringSources",
										action: "add",
										target: { pasukCoordinates: [{ perekId: 1, pasuk: 2 }] },
									},
								],
							},
						},
					],
				}),
			),
		);
	});
	it("retains a reviewed article-link command and expiry when editing the ordinary PR", async () => {
		const change = {
			kind: "article_links",
			targetId: "17",
			before: {},
			after: {
				commands: [
					{
						relationshipKey: "dedicationAssignments",
						action: "replace",
						target: { dedicationId: 3, expiresAt: "2030-01-02 03:04:05" },
					},
				],
			},
			labels: {},
		};
		const initial = {
			id: ID,
			kind: "pr",
			title: "קישורי מאמר",
			description: "תיאור",
			assignee: { kind: "unassigned" },
			evidence: [
				{ citation: "בראשית א ב", quote: "מקור", note: "", url: null },
			],
			changes: [change],
			issueId: null,
			closeIssue: true,
		} as unknown as Contribution;
		const { submit } = setup("pr", { initial });
		expect(screen.getByLabelText("מספר מאמר")).toHaveValue("17");
		expect(screen.getByLabelText("תוקף הקדשה 1")).toHaveValue(
			"2030-01-02T03:04:05",
		);
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				expect.objectContaining({
					changes: [
						{
							kind: change.kind,
							targetId: change.targetId,
							after: change.after,
						},
					],
				}),
			),
		);
	});
	it("offers an article aggregate only when there is one change in the PR", () => {
		setup("pr");
		fireEvent.click(screen.getByRole("button", { name: "+ הוספת שינוי" }));
		expect(screen.getAllByRole("option", { name: "קישורי מאמר" })).toHaveLength(
			2,
		);
		for (const option of screen.getAllByRole("option", { name: "קישורי מאמר" }))
			expect(option).toBeDisabled();
	});
	it.each([undefined, "failed", "succeeded"] as const)(
		"preserves an existing empty sequence only after a successful migration (%s)",
		async (status) => {
			const initial = {
				id: ID,
				kind: "pr",
				title: "Migrated proposal",
				description: "Keep the context",
				assignee: { kind: "unassigned" },
				evidence: [
					{
						citation: "בראשית א א",
						quote: "Existing source",
						url: null,
						note: "",
					},
				],
				issueId: OTHER,
				closeIssue: true,
				changes: [],
				...(status
					? {
							apiMigration: {
								status,
								from: 1,
								to: 4,
								at: "now",
								steps: [],
								error: status === "failed" ? "Cannot migrate" : null,
							},
						}
					: {}),
			} as unknown as Contribution;
			const { submit } = setup("pr", { initial });
			expect(screen.queryByLabelText("סוג שינוי")).not.toBeInTheDocument();
			fireEvent.change(screen.getByLabelText("תיאור"), {
				target: { value: "Revised explanation" },
			});
			fireEvent.change(screen.getByLabelText("מה המקור מוכיח?"), {
				target: { value: "Clarified evidence" },
			});
			fireEvent.submit(screen.getByRole("form"));
			if (status === "succeeded") {
				await waitFor(() =>
					expect(submit).toHaveBeenCalledWith(
						expect.objectContaining({
							description: "Revised explanation",
							evidence: [
								expect.objectContaining({ note: "Clarified evidence" }),
							],
							changes: [],
						}),
					),
				);
			} else {
				expect(await screen.findByRole("alert")).toHaveTextContent(
					"A PR requires 1-40 typed changes",
				);
				expect(submit).not.toHaveBeenCalled();
			}
		},
	);
	it("preserves all four assignee kinds and submits the selected registered agent as the initial work trigger", async () => {
		const agent = {
			id: OTHER,
			name: "My workstation",
			provider: "local_llm",
			enabled: true,
		} as ContributionAgentSummary;
		const { submit } = setup("issue", {
			agents: [
				agent,
				{ ...agent, id: "disabled", name: "Disabled", enabled: false },
				{ ...agent, id: "aws", name: "Cloud", provider: "aws_llm" },
			],
		});
		description();
		const assignee = screen.getByLabelText("אחראי", { exact: true });
		expect(assignee.querySelectorAll("option")).toHaveLength(4);
		fireEvent.change(assignee, { target: { value: "local_llm" } });
		const picker = screen.getByLabelText("סוכן מטפל");
		expect(picker.querySelectorAll("option")).toHaveLength(3);
		expect(
			screen.getByRole("option", { name: "Disabled (מושבת)" }),
		).toBeDisabled();
		fireEvent.change(picker, { target: { value: OTHER } });
		expect(screen.getByRole("note")).toHaveTextContent(/שמירת/);
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				expect.objectContaining({
					assignee: { kind: "local_llm", agentId: OTHER },
				}),
			),
		);
	});
	it("edits an existing metadata proposal and independently controls linked-issue closure", async () => {
		const initial = {
			kind: "pr",
			title: "Existing proposal",
			description: "Evidence supplied",
			assignee: { kind: "unassigned" },
			evidence: [],
			issueId: OTHER,
			closeIssue: true,
			changes: [
				{
					kind: "metadata",
					targetId: ID,
					before: { displayName: "Old" },
					after: { displayName: "Proposed" },
					labels: {},
				},
			],
		} as unknown as Contribution;
		const { submit } = setup("pr", { initial });
		expect(screen.getByLabelText("שם תצוגה")).toHaveValue("Proposed");
		fireEvent.change(screen.getByLabelText("יישות"), {
			target: { value: "" },
		});
		fireEvent.change(screen.getByLabelText("יישות"), { target: { value: ID } });
		fireEvent.change(screen.getByLabelText("שם תצוגה"), {
			target: { value: "Repaired" },
		});
		fireEvent.click(screen.getByLabelText("סגירת הפנייה המקושרת לאחר מיזוג"));
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				expect.objectContaining({
					closeIssue: false,
					changes: [
						{
							kind: "metadata",
							targetId: ID,
							after: { displayName: "Repaired" },
						},
					],
				}),
			),
		);
	});
	it("retains both evidence rows while editing only the selected citation and note", () => {
		setup();
		fireEvent.click(screen.getByText("+ הוספת מקור"));
		fireEvent.click(screen.getByText("+ הוספת מקור"));
		fireEvent.change(screen.getAllByLabelText("הפניה למקור")[1], {
			target: { value: "Second citation" },
		});
		fireEvent.change(screen.getAllByLabelText("מה המקור מוכיח?")[1], {
			target: { value: "Second note" },
		});
		expect(screen.getAllByLabelText("הפניה למקור")[0]).toHaveValue("");
		expect(screen.getAllByLabelText("מה המקור מוכיח?")[1]).toHaveValue(
			"Second note",
		);
	});
	it("keeps a draft after a non-Error transport rejection", async () => {
		setup("issue", { onSubmit: vi.fn().mockRejectedValue("disconnected") });
		description();
		fireEvent.submit(screen.getByRole("form"));
		expect(await screen.findByRole("alert")).toHaveTextContent("השמירה נכשלה");
	});
	it("offers exactly the four requested assignee kinds", () => {
		const change = vi.fn();
		render(<AssigneePicker value={{ kind: "unassigned" }} onChange={change} />);
		expect(
			screen.getAllByRole("option").map((option) => option.textContent),
		).toEqual(["ללא שיוך", "עורך אנושי", "AWS LLM", "Local LLM"]);
		fireEvent.change(screen.getByLabelText("אחראי"), {
			target: { value: "aws_llm" },
		});
		expect(change).toHaveBeenCalledWith({ kind: "aws_llm" });
		fireEvent.change(screen.getByLabelText("אחראי"), {
			target: { value: "human" },
		});
		expect(change).toHaveBeenCalledWith({ kind: "human", id: "", name: "" });
	});
	it("edits a human assignee handle", () => {
		const change = vi.fn();
		render(
			<AssigneePicker
				value={{ kind: "human", id: "alice", name: "Alice" }}
				onChange={change}
			/>,
		);
		fireEvent.change(screen.getByLabelText("שם משתמש אחראי"), {
			target: { value: "doradsoft" },
		});
		expect(change).toHaveBeenCalledWith({
			kind: "human",
			id: "doradsoft",
			name: "doradsoft",
		});
	});
	it("submits an issue with evidence and an explicit local model assignment", async () => {
		const { submit } = setup();
		description();
		fireEvent.change(screen.getByLabelText("אחראי"), {
			target: { value: "local_llm" },
		});
		fireEvent.click(screen.getByText("+ הוספת מקור"));
		fireEvent.change(screen.getByLabelText("הפניה למקור"), {
			target: { value: "בראשית א א" },
		});
		fireEvent.change(screen.getByLabelText("ציטוט רלוונטי"), {
			target: { value: "ציטוט" },
		});
		fireEvent.change(screen.getByLabelText("קישור למקור (אופציונלי)"), {
			target: { value: "https://example.com" },
		});
		fireEvent.change(screen.getByLabelText("מה המקור מוכיח?"), {
			target: { value: "הסבר" },
		});
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "issue",
					assignee: { kind: "local_llm" },
					changes: [],
					evidence: [
						{
							citation: "בראשית א א",
							quote: "ציטוט",
							url: "https://example.com",
							note: "הסבר",
						},
					],
				}),
			),
		);
	});
	it("adds and removes evidence before saving", () => {
		setup();
		fireEvent.click(screen.getByText("+ הוספת מקור"));
		expect(screen.getByLabelText("הפניה למקור")).toBeInTheDocument();
		fireEvent.click(screen.getByText("הסרת מקור 1"));
		expect(screen.queryByLabelText("הפניה למקור")).not.toBeInTheDocument();
	});
	it("builds an existing family deletion from a named record", async () => {
		const { submit } = setup("pr");
		description();
		fireEvent.change(screen.getByLabelText("קשר או זיהוי קיים"), {
			target: { value: OTHER },
		});
		fireEvent.click(screen.getByLabelText("מחיקת הקשר או הזיהוי"));
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				expect.objectContaining({
					changes: [{ kind: "parent_child", targetId: OTHER, after: null }],
				}),
			),
		);
	});
	it("builds a maternal relationship with a numeric birth order", async () => {
		const { submit } = setup("pr");
		description();
		fireEvent.change(screen.getByLabelText("הורה"), { target: { value: ID } });
		fireEvent.change(screen.getByLabelText("ילד"), {
			target: { value: OTHER },
		});
		fireEvent.change(screen.getByLabelText("תפקיד ההורה"), {
			target: { value: "MOTHER" },
		});
		fireEvent.change(screen.getByLabelText("סדר לידה"), {
			target: { value: "2" },
		});
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				expect.objectContaining({
					changes: [
						expect.objectContaining({
							kind: "parent_child",
							after: expect.objectContaining({
								birthOrder: 2,
								parentId: ID,
								childId: OTHER,
								parentRole: "MOTHER",
							}),
						}),
					],
				}),
			),
		);
	});
	it("offers typed metadata and new-entry forms with no content field", async () => {
		const { submit } = setup("pr");
		description();
		fireEvent.change(screen.getByLabelText("סוג שינוי"), {
			target: { value: "entry" },
		});
		fireEvent.change(screen.getByLabelText("שם ייחודי"), {
			target: { value: "חדש" },
		});
		fireEvent.change(screen.getAllByLabelText("כותרת")[1], {
			target: { value: "חדש" },
		});
		fireEvent.change(screen.getByLabelText("שם תצוגה"), {
			target: { value: "איש חדש" },
		});
		expect(screen.queryByLabelText("תוכן")).not.toBeInTheDocument();
		fireEvent.submit(screen.getByRole("form"));
		await waitFor(() =>
			expect(submit).toHaveBeenCalledWith(
				expect.objectContaining({
					changes: [
						expect.objectContaining({
							kind: "entry",
							after: expect.objectContaining({ entityType: "PERSON" }),
						}),
					],
				}),
			),
		);
	});
	it("adds a second change, changes its type and removes it", () => {
		setup("pr");
		fireEvent.click(screen.getByText("+ הוספת שינוי"));
		expect(screen.getAllByLabelText("סוג שינוי")).toHaveLength(2);
		fireEvent.change(screen.getAllByLabelText("סוג שינוי")[1], {
			target: { value: "place" },
		});
		expect(screen.getByLabelText("קו רוחב")).toBeInTheDocument();
		fireEvent.click(screen.getAllByText("הסרת שינוי")[1]);
		expect(screen.getAllByLabelText("סוג שינוי")).toHaveLength(1);
	});
	it("retains draft text on save failure and displays the server message", async () => {
		setup("issue", {
			onSubmit: vi.fn().mockRejectedValue(new Error("Reload required")),
		});
		description();
		fireEvent.submit(screen.getByRole("form"));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Reload required",
		);
		expect(screen.getByLabelText("תיאור")).toHaveValue("תיאור מבוסס ראיות");
	});
	it("validates incomplete operations before invoking persistence", async () => {
		const { submit } = setup("pr");
		description();
		fireEvent.submit(screen.getByRole("form"));
		expect(await screen.findByRole("alert")).toHaveTextContent("parentId");
		expect(submit).not.toHaveBeenCalled();
	});
	it("disables submission while saving and supports cancel", () => {
		const { cancel } = setup("issue", { busy: true });
		expect(screen.getByRole("button", { name: "שומר..." })).toBeDisabled();
		expect(screen.getByRole("button", { name: "ביטול" })).toBeDisabled();
		expect(cancel).not.toHaveBeenCalled();
	});
});
