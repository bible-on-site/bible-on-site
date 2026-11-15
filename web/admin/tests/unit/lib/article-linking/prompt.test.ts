import { describe, expect, it } from "vitest";
import {
	buildArticleLinkSystemPrompt,
	buildArticleLinkUserMessage,
} from "~/lib/article-linking/prompt";
import { catalogue, snapshot } from "./fixture";

describe("article-link prompt attribution policy", () => {
	it("offers supported relationship targets without offering authorship", () => {
		const prompt = buildArticleLinkSystemPrompt();
		const [instructions, outputJson] = prompt.split("OUTPUT JSON shape:\n");
		const shape = JSON.parse(outputJson);

		expect(instructions).toContain(
			"Author attribution is fixed explicitly on upload/import",
		);
		expect(instructions).toContain("Never infer,");
		expect(instructions).not.toMatch(/^- author \(/m);
		expect(instructions).toMatch(/^- coveringSources \(/m);
		expect(shape.proposals[0].relationshipKey.split("|")).not.toContain(
			"author",
		);
		expect(shape.proposals[0].relationshipKey.split("|")).toContain(
			"coveringSources",
		);
		expect(outputJson).not.toContain("authorId");
	});

	it("keeps upload attribution as context without sending author candidate targets", () => {
		const message = buildArticleLinkUserMessage({
			articleId: 123,
			articleName: "מאמר בדיקה",
			articleAbstract: null,
			plainText: "בראשית יח ב",
			current: {
				...snapshot,
				perekLabel: "בראשית א",
				authorName: "הרב קוק",
				coveringSources: [],
				dedications: [],
			},
			catalogue: {
				...catalogue,
				authors: [...catalogue.authors, { id: 7, name: "מחבר מועמד אחר" }],
			},
		});

		expect(message).toContain('"authorId":2');
		expect(message).toContain('"authorName":"הרב קוק"');
		expect(message).not.toContain("AUTHOR CATALOGUE");
		expect(message).not.toContain("מחבר מועמד אחר");
		expect(message).toContain("DEDICATION CATALOGUE");
		expect(message).toContain("בראשית יח ב");
	});
});
