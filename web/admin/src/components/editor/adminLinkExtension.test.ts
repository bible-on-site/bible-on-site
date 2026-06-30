import { describe, expect, it } from "vitest";
import { buildLinkHref, inferLinkType } from "./adminLinkExtension";

describe("adminLinkExtension", () => {
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
		});

		it("adds https for external", () => {
			expect(buildLinkHref("external", "example.com")).toEqual({
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
