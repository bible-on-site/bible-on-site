import { describe, expect, it } from "vitest";
import {
	AdminLink,
	buildLinkHref,
	inferLinkType,
} from "~/components/editor/adminLinkExtension";

type LinkOptions = {
	openOnClick?: boolean;
	HTMLAttributes?: Record<string, unknown>;
};

type LinkAttribute = {
	default: string | null;
	parseHTML: (element: HTMLElement) => string | null;
	renderHTML: (attributes: {
		linkType?: string | null;
	}) => Record<string, string>;
};

function linkOptions(parentOptions: LinkOptions = {}): LinkOptions {
	const addOptions = AdminLink.config.addOptions as
		| ((this: { parent?: () => LinkOptions }) => LinkOptions)
		| undefined;
	if (!addOptions) throw new Error("AdminLink must define addOptions");

	return addOptions.call({ parent: () => parentOptions });
}

function linkTypeAttribute(
	parentAttributes: Record<string, unknown> = {},
): LinkAttribute {
	const addAttributes = AdminLink.config.addAttributes as
		| ((this: { parent?: () => Record<string, unknown> }) => Record<
				string,
				unknown
		  >)
		| undefined;
	if (!addAttributes) throw new Error("AdminLink must define addAttributes");

	const attributes = addAttributes.call({ parent: () => parentAttributes });
	return attributes.linkType as LinkAttribute;
}

describe("adminLinkExtension", () => {
	it("disables browser navigation while preserving parent HTML attributes", () => {
		const options = linkOptions({
			openOnClick: true,
			HTMLAttributes: { class: "article-link", target: "_blank" },
		});

		expect(options.openOnClick).toBe(false);
		expect(options.HTMLAttributes).toEqual({
			class: "article-link",
			target: null,
			rel: null,
		});
	});

	it("adds a link type attribute without dropping parent attributes", () => {
		const attributes = AdminLink.config.addAttributes as
			| ((this: { parent?: () => Record<string, unknown> }) => Record<
					string,
					unknown
			  >)
			| undefined;
		if (!attributes) throw new Error("AdminLink must define addAttributes");

		const merged = attributes.call({
			parent: () => ({ href: { default: null } }),
		});

		expect(merged.href).toEqual({ default: null });
		expect((merged.linkType as LinkAttribute).default).toBeNull();
	});

	it("parses explicit and inferred link types from DOM anchors", () => {
		const attribute = linkTypeAttribute();
		const anchor = document.createElement("a");

		anchor.setAttribute("data-link-type", "comment");
		anchor.setAttribute("href", "https://example.com");
		expect(attribute.parseHTML(anchor)).toBe("comment");

		anchor.removeAttribute("data-link-type");
		anchor.setAttribute("href", "/articles/7");
		expect(attribute.parseHTML(anchor)).toBe("internal");
	});

	it("renders only non-external link type metadata", () => {
		const attribute = linkTypeAttribute();

		expect(attribute.renderHTML({ linkType: "external" })).toEqual({});
		expect(attribute.renderHTML({ linkType: null })).toEqual({});
		expect(attribute.renderHTML({ linkType: "internal" })).toEqual({
			"data-link-type": "internal",
		});
	});

	describe("inferLinkType", () => {
		it("detects comment anchors", () => {
			expect(inferLinkType("#note-3")).toBe("comment");
			expect(inferLinkType("  #note-12 ")).toBe("comment");
		});

		it("detects external URLs", () => {
			expect(inferLinkType("https://a.com")).toBe("external");
			expect(inferLinkType("//cdn.example/x")).toBe("external");
			expect(inferLinkType("mailto:x@y.com")).toBe("external");
		});

		it("treats bare paths as internal", () => {
			expect(inferLinkType("/foo")).toBe("internal");
			expect(inferLinkType("slug-only")).toBe("internal");
		});

		it("defaults empty to external", () => {
			expect(inferLinkType("")).toBe("external");
			expect(inferLinkType(null)).toBe("external");
		});
	});

	describe("buildLinkHref", () => {
		it("normalizes comment input", () => {
			expect(buildLinkHref("comment", "2")).toEqual({
				href: "#note-2",
				linkType: "comment",
			});
			expect(buildLinkHref("comment", "#note-5")).toEqual({
				href: "#note-5",
				linkType: "comment",
			});
			expect(buildLinkHref("comment", "note-8 extra")).toEqual({
				href: "#note-8",
				linkType: "comment",
			});
			expect(buildLinkHref("comment", "notes")).toEqual({
				href: "#note-1",
				linkType: "comment",
			});
		});

		it("adds https for external", () => {
			expect(buildLinkHref("external", "example.com")).toEqual({
				href: "https://example.com",
				linkType: "external",
			});
			expect(buildLinkHref("external", "")).toEqual({
				href: "https://",
				linkType: "external",
			});
			expect(buildLinkHref("external", "https://example.com")).toEqual({
				href: "https://example.com",
				linkType: "external",
			});
		});

		it("passes internal through trimmed", () => {
			expect(buildLinkHref("internal", "  my-slug  ")).toEqual({
				href: "my-slug",
				linkType: "internal",
			});
		});
	});
});
