import { describe, expect, it } from "vitest";
import { derivePreservationConstraints } from "~/lib/tanahpedia/contribution-preservation-constraints";

const derive = (body: string) =>
	derivePreservationConstraints([{ id: "human-comment", body }]);

describe("explicit preservation instructions", () => {
	it("recognizes the live Hebrew status request without interpreting the question as an edit", () => {
		expect(
			derive(
				"בדיקת מצב: האם ההצעה הזאת כבר מוכנה למיזוג, ומה עדיין חסר? ענה בתגובה על סמך מצב ה-PR הנוכחי. יש לשמר בדיוק את התיאור, הראיות ורצף השינויים.",
			),
		).toEqual(
			["description", "evidence", "changes"].map((field) => ({
				field,
				commentIds: ["human-comment"],
			})),
		);
	});
	it.each([
		"Please keep the title and description unchanged.",
		"Preserve exactly the current title, the existing description.",
		"נא לשמר את הכותרת והתיאור בדיוק.",
	])("recognizes an entire finite field list: %s", (body) => {
		expect(derive(body).map(({ field }) => field)).toEqual([
			"title",
			"description",
		]);
	});
	it.each([
		"If useful, preserve the description.",
		"Should we preserve the description?",
		"Keep description? Improve it if necessary.",
		"Keep description？ Improve it if necessary.",
		"יש לשמר את התיאור? שפר אותו אם צריך.",
		"Do not preserve the description.",
		"Preserve evidence and add quotes.",
		"Keep evidence. Also add quotes.",
		'Keep description. Replace the description with exactly "new".',
		'Example: "Keep description."',
		'Keep description "new value".',
		"```\nKeep description.\n```",
		"`Keep description.`",
		"> Keep description.",
		'"Keep description.',
		"אל לשמר את התיאור.",
		"לשמר את התיאור אם אפשר.",
	])(
		"leaves ambiguous, competing or quoted instructions for clarification: %s",
		(body) => {
			expect(derive(body)).toEqual([]);
		},
	);
	it("deduplicates comment IDs and retains separate pending human requests", () => {
		expect(
			derivePreservationConstraints([
				{ id: "one", body: "Keep evidence. Keep evidence." },
				{ id: "two", body: "Preserve evidence." },
			]),
		).toEqual([{ field: "evidence", commentIds: ["one", "two"] }]);
	});
	it.each([
		"Is the description unchanged? Keep description.",
		"האם התיאור השתנה? יש לשמר בדיוק את התיאור.",
		"Review the description. Keep description.",
		"Please review the description. Keep description.",
	])(
		"keeps a clear preservation instruction after a non-editing mention: %s",
		(body) => {
			expect(derive(body)).toEqual([
				{ field: "description", commentIds: ["human-comment"] },
			]);
		},
	);
	it("does not let an opposing preservation directive establish a lock", () => {
		expect(derive("Keep description. Do not keep description.")).toEqual([]);
	});
	it.each([
		'Keep description. "Update the description."',
		'Keep description. Example: "Update the description."',
		"Keep description.\n```\nUpdate the description.\n```",
		"Keep description.\n> Update the description.",
	])(
		"opaque examples cannot cancel a real human preservation request: %s",
		(body) => {
			expect(derive(body)).toEqual([
				{ field: "description", commentIds: ["human-comment"] },
			]);
		},
	);
	it.each([
		"Keep description. If necessary, update the description.",
		"😀. Keep description.",
		"Please. Keep description.",
		"Keep description. Actually, replace the description.",
		"Keep description. I want to update the description.",
		"Keep description. If necessary, improve it.",
		"Keep description. It may need some work.",
		"יש לשמר את התיאור. אם צריך, עדכן את התיאור.",
		"Keep description. Review and update the description.",
		"Keep description. Review the description ולשנות אותו.",
	])(
		"leaves unknown or conditional editing context unconstrained: %s",
		(body) => {
			expect(derive(body)).toEqual([]);
		},
	);
	it("handles comma-and lists without treating long unknown qualifiers as field names", () => {
		expect(
			derive("Keep title, description, and evidence.").map(
				({ field }) => field,
			),
		).toEqual(["title", "description", "evidence"]);
		expect(derive(`Keep ${"the ".repeat(1800)}description.`)).toEqual([]);
	});
	it("a competing edit affects only its named field", () => {
		expect(derive("Keep evidence and title. Change the title.")).toEqual([
			{ field: "evidence", commentIds: ["human-comment"] },
		]);
	});
});
