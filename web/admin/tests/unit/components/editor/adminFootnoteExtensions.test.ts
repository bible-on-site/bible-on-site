import { describe, expect, it } from "vitest";
import {
	AdminFootnoteDocument,
	AdminFootnoteReference,
	adminFootnoteExtensions,
} from "~/components/editor/adminFootnoteExtensions";

describe("adminFootnoteExtensions", () => {
	it("allows a single trailing footnote list in the document schema", () => {
		expect(AdminFootnoteDocument.config.content).toBe("block+ footnotes?");
		expect(adminFootnoteExtensions).toContain(AdminFootnoteReference);
	});

	it("renders an accessible Hebrew reference while preserving parser attributes", () => {
		const renderHTML = AdminFootnoteReference.config.renderHTML;
		if (!renderHTML) throw new Error("Expected the footnote reference renderer");

		expect(
			renderHTML.call({} as never, {
				HTMLAttributes: {
					class: "footnote-ref",
					"data-id": "footnote-id",
					referenceNumber: "15",
				},
			} as never),
		).toEqual([
			"sup",
			{ id: "fnref:15" },
			[
				"a",
				{
					class: "footnote-ref",
					"data-id": "footnote-id",
					"data-reference-number": "15",
					role: "doc-noteref",
				},
				"טו",
			],
		]);
	});
});
