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
		if (!renderHTML)
			throw new Error("Expected the footnote reference renderer");

		expect(
			renderHTML.call(
				{ options: { HTMLAttributes: {} } } as never,
				{
					/* v4 keeps referenceNumber on node.attrs (rendered: false);
					   HTMLAttributes carries only the rendered data-id. */
					node: {
						attrs: { referenceNumber: "15", "data-id": "footnote-id" },
					},
					HTMLAttributes: { "data-id": "footnote-id" },
				} as never,
			),
		).toEqual([
			"sup",
			{ id: "fnref:15" },
			[
				"a",
				{
					class: "footnote-ref",
					"data-id": "footnote-id",
					href: "#fn:15",
					"data-reference-number": "15",
					role: "doc-noteref",
				},
				"טו",
			],
		]);
	});

	it("keeps a non-numeric stored marker as the visible text", () => {
		/* v4's parser falls back to the anchor text when data-reference-number
		   is absent, so a stored "א" can arrive as the referenceNumber until
		   the mount sync renumbers it. */
		const renderHTML = AdminFootnoteReference.config.renderHTML;
		if (!renderHTML)
			throw new Error("Expected the footnote reference renderer");

		expect(
			renderHTML.call(
				{ options: { HTMLAttributes: {} } } as never,
				{
					node: { attrs: { referenceNumber: "א", "data-id": "x" } },
					HTMLAttributes: { "data-id": "x" },
				} as never,
			),
		).toEqual([
			"sup",
			{ id: "fnref:א" },
			[
				"a",
				{
					class: "footnote-ref",
					"data-id": "x",
					href: "#fn:א",
					"data-reference-number": "א",
					role: "doc-noteref",
				},
				"א",
			],
		]);
	});

	it("renders a not-yet-numbered reference without broken attributes", () => {
		const renderHTML = AdminFootnoteReference.config.renderHTML;
		if (!renderHTML)
			throw new Error("Expected the footnote reference renderer");

		expect(
			renderHTML.call(
				{ options: { HTMLAttributes: {} } } as never,
				{
					node: { attrs: { referenceNumber: null, "data-id": null } },
					HTMLAttributes: { "data-id": null },
				} as never,
			),
		).toEqual([
			"sup",
			{},
			[
				"a",
				{
					class: "footnote-ref",
					"data-id": null,
					role: "doc-noteref",
				},
				"",
			],
		]);
	});
});
