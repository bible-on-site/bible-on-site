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
	it("a competing edit affects only its named field", () => {
		expect(derive("Keep evidence and title. Change the title.")).toEqual([
			{ field: "evidence", commentIds: ["human-comment"] },
		]);
	});
});
