import { describe, expect, it } from "vitest";
import { deriveVerbatimFieldConstraints } from "~/lib/tanahpedia/contribution-verbatim-constraints";

const current = {
	title: "Existing title",
	description: "Existing description",
};
const derive = (body: string, fields = current) =>
	deriveVerbatimFieldConstraints([{ id: "human-1", body }], fields);

describe("deterministic human verbatim field constraints", () => {
	it("appends a Hebrew exact sentence while preserving unrelated negative constraints", () => {
		expect(
			derive(
				'נא להוסיף לתיאור את המשפט המדויק "המקור נבדק היטב". יש לשמור על אותה הצעה וכל שדות הקישורים ללא שינוי, ולא לפתוח PR נוסף.',
			),
		).toEqual([
			{
				field: "description",
				expected: "Existing description\nהמקור נבדק היטב",
				commentIds: ["human-1"],
			},
		]);
	});
	it.each([
		'Please append the exact text "New detail" to the description. Do not open another PR.',
		'Add "New detail" verbatim to description.',
		'Please add the exact sentence to the description: "New detail".',
		'Append "New detail", verbatim, to the description.',
		'Append "New detail" byte-for-byte to the description.',
		'הוסף לתיאור בדיוק "New detail".',
		'יש לצרף לתיאור את הטקסט המדויק "New detail".',
		'הוסף בדיוק "New detail" לתיאור.',
	])("recognizes an explicit append directive: %s", (body) => {
		expect(derive(body)).toEqual([
			{
				field: "description",
				expected: "Existing description\nNew detail",
				commentIds: ["human-1"],
			},
		]);
	});
	it.each([
		'Please set the title to the exact text "New heading".',
		'Replace title with "New heading" verbatim.',
		'נא להחליף את הכותרת בטקסט המדויק "New heading".',
		'הגדר את הכותרת בדיוק "New heading".',
	])("recognizes whole-field replacement: %s", (body) => {
		expect(derive(body)).toEqual([
			{ field: "title", expected: "New heading", commentIds: ["human-1"] },
		]);
	});
	it("uses one ASCII space for a title append without changing existing bytes", () => {
		expect(
			derive('Append "  Ending  " verbatim to the title.', {
				title: "  Start  ",
				description: "Untouched",
			}),
		).toEqual([
			{
				field: "title",
				expected: "  Start     Ending  ",
				commentIds: ["human-1"],
			},
		]);
	});
	it("preserves quote whitespace, line breaks and decomposed Unicode byte-for-byte", () => {
		const quote = "  א\u05b0 e\u0301\nSecond line  ";
		const old = "  Original\r\nbytes  ";
		expect(
			derive(`Please set description to the exact text "${quote}".`, {
				...current,
				description: old,
			})[0].expected,
		).toBe(quote);
		expect(
			derive(`Append "${quote}" verbatim to description.`, {
				...current,
				description: old,
			})[0].expected,
		).toBe(`${old}\n${quote}`);
	});
	it("does not interpret negative or field words inside the quotation as commands", () => {
		expect(
			derive(
				'Please append "Do not replace title if unsure?" verbatim to description.',
			),
		).toEqual([
			{
				field: "description",
				expected: "Existing description\nDo not replace title if unsure?",
				commentIds: ["human-1"],
			},
		]);
		expect(derive('נא להוסיף לתיאור בדיוק "לא לשנות כותרת".')[0].expected).toBe(
			"Existing description\nלא לשנות כותרת",
		);
	});
	it.each([
		"Append “Exact text” verbatim to description.",
		"Append ״Exact text״ verbatim to description.",
		"Append 'Exact text' verbatim to description.",
		"Append ‘Exact text’ verbatim to description.",
	])("accepts a single balanced quotation style: %s", (body) => {
		expect(derive(body)[0].expected).toBe("Existing description\nExact text");
	});
	it.each([
		"The description is good; no exact copy request.",
		'Please do not append "No change" verbatim to description.',
		'Do not replace title with the exact text "No change".',
		'אל תוסיף לתיאור את המשפט המדויק "No change".',
		'נא לא להוסיף לתיאור בדיוק "No change".',
		'Please append the exact text "No change" to description, but do not append it.',
		'נא להוסיף לתיאור בדיוק "No change", אבל אל תוסיף אותו.',
		'Could you append "Maybe" verbatim to description?',
		'If approved, append "Maybe" verbatim to description.',
		'Please append "Maybe" verbatim to description if needed.',
		'נא להוסיף לתיאור בדיוק "Maybe" אם צריך.',
		'Please append "Maybe" verbatim to description?',
		'The exact text "Poor wording" in the description is wrong.',
		'"Poor wording" should not be the exact description.',
		'Add exactly these words to the description: "Wrong wording" is not what I requested.',
		'Add exactly these words to the description: "Wrong wording", that is incorrect.',
		'Add exactly these words to the description: "Wrong wording" was a bad example.',
		'Add exactly these words to the description: "Wrong wording" is not the intended text.',
		'Add exactly these words to the description: "Wrong wording" — that\'s not the wording I want.',
		'Add exactly these words to the description: "Wrong wording" might be unsuitable.',
		'Add exactly these words to the description: "Wrong wording" is an example, not a request.',
		'נא להוסיף לתיאור בדיוק "נוסח שגוי" אינו מה שביקשתי.',
		'הוסף לתיאור בדיוק "נוסח שגוי", זה לא הנוסח הנכון.',
		'For example, append "Example" verbatim to description.',
		'Please append "One" or "Two" verbatim to description.',
		'Please append "Both" verbatim to title and description.',
		'Please append or replace description with the exact text "Both".',
		'Please replace the word in description with the exact text "Part".',
		'נא להחליף את המילה בתיאור בטקסט המדויק "Part".',
		'Please append "Unspecified" to description.',
		'הוסף לתיאור לאמדויק "נוסח לא ברור".',
		'הוסף לתיאור מדויקבערך "נוסח לא ברור".',
		'Please append the exact text "No field".',
		'Please append the exact text "No end to description.',
		'Please append the exact text "" to description.',
		'Please append the exact text "   " to description.',
	])("does not mechanically edit unclear or negative intent: %s", (body) => {
		expect(derive(body)).toEqual([]);
	});
	it("does not duplicate an append already exactly at the final boundary", () => {
		for (const description of ["Copied", "Old\nCopied"])
			expect(
				derive('Append "Copied" verbatim to description.', {
					...current,
					description,
				})[0].expected,
			).toBe(description);
		for (const title of ["Copied", "Old Copied"])
			expect(
				derive('Append "Copied" verbatim to title.', { ...current, title })[0]
					.expected,
			).toBe(title);
	});
	it("does not treat a middle occurrence or substring as a satisfied append", () => {
		expect(
			derive('Append "Copied" verbatim to description.', {
				...current,
				description: "Copied\nLater",
			})[0].expected,
		).toBe("Copied\nLater\nCopied");
		expect(
			derive('Append "at" verbatim to title.', { ...current, title: "coat" })[0]
				.expected,
		).toBe("coat at");
	});
	it("only whole-field equality satisfies replacement and empty append has no separator", () => {
		expect(
			derive('Set description to "Copied" verbatim.', {
				...current,
				description: "Old\nCopied",
			})[0].expected,
		).toBe("Copied");
		expect(
			derive('Append "Copied" verbatim to description.', {
				...current,
				description: "",
			})[0].expected,
		).toBe("Copied");
	});
	it("merges identical requests and unique human IDs without normalizing quotes", () => {
		const comments = [
			{ id: "one", body: 'Append "Exact" verbatim to description.' },
			{ id: "two", body: 'נא להוסיף לתיאור בדיוק "Exact".' },
			{ id: "two", body: 'Append "Exact" verbatim to description.' },
		];
		expect(deriveVerbatimFieldConstraints(comments, current)).toEqual([
			{
				field: "description",
				expected: "Existing description\nExact",
				commentIds: ["one", "two"],
			},
		]);
	});
	it.each([
		'Append "Different" verbatim to description.',
		'Set description to "Same" verbatim.',
		'Append "Same " verbatim to description.',
	])("leaves conflicting same-field requests for clarification: %s", (body) => {
		expect(
			deriveVerbatimFieldConstraints(
				[
					{ id: "one", body: 'Append "Same" verbatim to description.' },
					{ id: "two", body },
				],
				current,
			),
		).toEqual([]);
	});
	it("independent fields remain constrained even if the other field conflicts", () => {
		expect(
			deriveVerbatimFieldConstraints(
				[
					{ id: "one", body: 'Append "One" verbatim to description.' },
					{ id: "two", body: 'Append "Two" verbatim to description.' },
					{ id: "three", body: 'Set title to "Final" verbatim.' },
				],
				current,
			),
		).toEqual([{ field: "title", expected: "Final", commentIds: ["three"] }]);
	});
	it.each([
		'Do not append "Neutral" verbatim to description.',
		"Don't append to description.",
		'אל תוסיף לתיאור בדיוק "Neutral".',
		"לא להוסיף לתיאור.",
		"Do not change the description.",
		"אל תשנה את התיאור.",
	])(
		"suppresses a mechanical edit contradicted by another pending human directive: %s",
		(body) => {
			const positive = {
				id: "positive",
				body: 'Append "Neutral" verbatim to description.',
			};
			const negative = { id: "negative", body };
			for (const comments of [
				[positive, negative],
				[negative, positive],
			])
				expect(deriveVerbatimFieldConstraints(comments, current)).toEqual([]);
		},
	);
	it("keeps unrelated fields and later unrelated negative clauses independent", () => {
		expect(
			deriveVerbatimFieldConstraints(
				[
					{ id: "positive", body: 'Append "Neutral" verbatim to description.' },
					{
						id: "title-negative",
						body: 'Do not append "Description" to title.',
					},
					{ id: "title-unchanged", body: "Do not change the title." },
					{
						id: "unrelated",
						body: "Do not add another PR; the description is satisfactory.",
					},
				],
				current,
			),
		).toEqual([
			{
				field: "description",
				expected: "Existing description\nNeutral",
				commentIds: ["positive"],
			},
		]);
	});
	it("does not treat negative copy wording or field names inside a quote as authority", () => {
		expect(
			deriveVerbatimFieldConstraints(
				[
					{ id: "positive", body: 'Append "Neutral" verbatim to description.' },
					{
						id: "title",
						body: 'Set title to "Do not append to description" verbatim.',
					},
				],
				current,
			),
		).toEqual([
			{
				field: "description",
				expected: "Existing description\nNeutral",
				commentIds: ["positive"],
			},
			{
				field: "title",
				expected: "Do not append to description",
				commentIds: ["title"],
			},
		]);
	});
	it("retains an overlength expected value so it cannot be truncated into false success", () => {
		const quote = "x".repeat(256);
		expect(derive(`Set title to "${quote}" verbatim.`)[0].expected).toBe(quote);
	});
});
