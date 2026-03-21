import Link from "@tiptap/extension-link";

export type AdminLinkType = "external" | "internal" | "comment";

/** TipTap's `setLink` typings omit custom `linkType` from `AdminLink`; cast at call sites — `linkType` is still applied at runtime. */
export type TipTapLinkMarkAttrs = {
	href: string;
	target?: string | null;
	rel?: string | null;
	class?: string | null;
};

function inferLinkType(href: string | null | undefined): AdminLinkType {
	if (!href) return "external";
	const h = href.trim();
	if (h.startsWith("#note")) return "comment";
	if (/^(https?:)?\/\//i.test(h) || /^mailto:/i.test(h)) return "external";
	return "internal";
}

export const AdminLink = Link.extend({
	name: "link",

	addOptions() {
		const parent = this.parent?.() ?? {};
		return {
			...parent,
			openOnClick: false,
			HTMLAttributes: {
				...(parent as { HTMLAttributes?: Record<string, unknown> })
					.HTMLAttributes,
				target: null,
				rel: null,
			},
		};
	},

	addAttributes() {
		return {
			...this.parent?.(),
			linkType: {
				default: null as AdminLinkType | null,
				parseHTML: (element) => {
					const raw = element.getAttribute("data-link-type");
					if (raw === "external" || raw === "internal" || raw === "comment") {
						return raw;
					}
					const href = element.getAttribute("href");
					return inferLinkType(href);
				},
				renderHTML: (attributes) => {
					const t = attributes.linkType as AdminLinkType | null;
					if (!t || t === "external") return {};
					return { "data-link-type": t };
				},
			},
		};
	},
});

export function buildLinkHref(
	type: AdminLinkType,
	rawInput: string,
): { href: string; linkType: AdminLinkType } {
	const trimmed = rawInput.trim();
	if (type === "comment") {
		const n = trimmed.replace(/^#?\s*note-?/i, "").replace(/\D.*/, "") || "1";
		return { href: `#note-${n}`, linkType: "comment" };
	}
	if (type === "external") {
		if (!trimmed) return { href: "https://", linkType: "external" };
		if (/^https?:\/\//i.test(trimmed)) return { href: trimmed, linkType: "external" };
		return { href: `https://${trimmed}`, linkType: "external" };
	}
	return { href: trimmed, linkType: "internal" };
}

export { inferLinkType };
