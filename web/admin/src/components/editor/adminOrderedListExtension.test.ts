import { describe, expect, it } from "vitest";
import { AdminOrderedList } from "./adminOrderedListExtension";

type OrderedListAttribute = {
	default: string;
	parseHTML: (element: HTMLElement) => string;
	renderHTML: (attributes: {
		orderedType?: string | null;
	}) => Record<string, string>;
};

function orderedListAttributes(
	parentAttributes: Record<string, unknown> = {},
): Record<string, unknown> {
	const addAttributes = AdminOrderedList.config.addAttributes as
		| ((this: { parent?: () => Record<string, unknown> }) => Record<
				string,
				unknown
		  >)
		| undefined;
	if (!addAttributes)
		throw new Error("AdminOrderedList must define addAttributes");

	return addAttributes.call({ parent: () => parentAttributes });
}

function orderedTypeAttribute(): OrderedListAttribute {
	return orderedListAttributes().orderedType as OrderedListAttribute;
}

describe("AdminOrderedList", () => {
	it("adds ordered type without dropping parent list attributes", () => {
		const attributes = orderedListAttributes({ keepMarks: { default: false } });

		expect(attributes.keepMarks).toEqual({ default: false });
		expect((attributes.orderedType as OrderedListAttribute).default).toBe(
			"decimal",
		);
	});

	it("parses supported ordered-list marker styles from DOM", () => {
		const attribute = orderedTypeAttribute();
		const list = document.createElement("ol");

		list.setAttribute("data-ordered-type", "hebrew-alpha");
		expect(attribute.parseHTML(list)).toBe("hebrew-alpha");

		list.setAttribute("data-ordered-type", "decimal");
		expect(attribute.parseHTML(list)).toBe("decimal");
	});

	it("falls back to decimal for missing or unsupported marker styles", () => {
		const attribute = orderedTypeAttribute();
		const list = document.createElement("ol");

		expect(attribute.parseHTML(list)).toBe("decimal");

		list.setAttribute("data-ordered-type", "roman");
		expect(attribute.parseHTML(list)).toBe("decimal");
	});

	it("renders data attributes only for custom ordered-list styles", () => {
		const attribute = orderedTypeAttribute();

		expect(attribute.renderHTML({ orderedType: "decimal" })).toEqual({});
		expect(attribute.renderHTML({ orderedType: null })).toEqual({});
		expect(attribute.renderHTML({ orderedType: "hebrew-alpha" })).toEqual({
			"data-ordered-type": "hebrew-alpha",
		});
	});
});
