import OrderedList from "@tiptap/extension-ordered-list";

export type OrderedListStyle = "decimal" | "hebrew-alpha";

/**
 * Ordered list with `data-ordered-type="hebrew-alpha"` for @counter-style markers (admin-prose.css).
 */
export const AdminOrderedList = OrderedList.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			orderedType: {
				default: "decimal" satisfies OrderedListStyle,
				parseHTML: (element) => {
					const t = element.getAttribute("data-ordered-type");
					if (t === "hebrew-alpha" || t === "decimal") return t;
					return "decimal";
				},
				renderHTML: (attributes) => {
					const t = attributes.orderedType as OrderedListStyle;
					if (!t || t === "decimal") return {};
					return { "data-ordered-type": t };
				},
			},
		};
	},
});
