import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	AssigneePicker,
	type ContributionCatalogue,
	ContributionComposer,
} from "~/components/tanahpedia/ContributionComposer";
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
	it("builds a new family operation with a numeric birth order", async () => {
		const { submit } = setup("pr");
		description();
		fireEvent.change(screen.getByLabelText("הורה"), { target: { value: ID } });
		fireEvent.change(screen.getByLabelText("ילד"), {
			target: { value: OTHER },
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
