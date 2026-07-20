/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import {
	buildKetavVeKabbalah929PerushHref,
	renderCitationWithTanachLinks,
	renderFamilyTreeCitationLine,
	PERUSH_NAME_HAKTAV_VEKABBALAH,
} from "@/lib/tanahpedia/tanach-citation-links";

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
	}: {
		children: React.ReactNode;
		href: string;
	}) => <a href={href}>{children}</a>,
}));

describe("renderCitationWithTanachLinks", () => {
	it("links sefer and perek without pasuk to /929/{perekId}", () => {
		const nodes = renderCitationWithTanachLinks("בראשית ה", "cite");
		const { container } = render(<div>{nodes}</div>);
		const a = container.querySelector("a");
		expect(a?.getAttribute("href")).toMatch(/^\/929\/\d+$/);
		expect(a?.textContent).toBe("בראשית ה");
	});

	it("links sefer, perek, and single pasuk with encoded slug", () => {
		const nodes = renderCitationWithTanachLinks("בראשית כט לב", "cite");
		render(<div>{nodes}</div>);
		const a = screen.getByRole("link", { name: "בראשית כט לב" });
		expect(a.getAttribute("href")).toMatch(
			/^\/929\/\d+\/%D7%9C%D7%91$/,
		);
	});

	it("links pasuk range with hyphen in href", () => {
		const nodes = renderCitationWithTanachLinks("בראשית ל ו-ח", "cite");
		render(<div>{nodes}</div>);
		const a = screen.getByRole("link", { name: "בראשית ל ו-ח" });
		expect(decodeURIComponent(a.getAttribute("href") ?? "")).toMatch(
			/\/929\/\d+\/ו-ח$/,
		);
	});

	it("links additional-volume citations and preserves surrounding text", () => {
		const nodes = renderCitationWithTanachLinks(
			"ראו שמואל א ג ד להרחבה",
			"cite",
		);
		const { container } = render(<div>{nodes}</div>);

		expect(container.textContent).toBe("ראו שמואל א ג ד להרחבה");
		const link = screen.getByRole("link", { name: "שמואל א ג ד" });
		expect(decodeURIComponent(link.getAttribute("href") ?? "")).toMatch(
			/\/929\/\d+\/ד$/,
		);
	});

	it("leaves unresolvable and plain text citations unlinked", () => {
		expect(
			buildKetavVeKabbalah929PerushHref("ספר לא קיים", "א", "א"),
		).toBeNull();

		const { container } = render(
			<div>{renderCitationWithTanachLinks("טקסט בלי מקור", "cite")}</div>,
		);
		expect(container.textContent).toBe("טקסט בלי מקור");
		expect(container.querySelector("a")).toBeNull();
	});
	it("leaves parseable but out-of-range citations as plain text", () => {
		const text =
			"\u05d1\u05e8\u05d0\u05e9\u05d9\u05ea \u05ea\u05ea\u05e7\u05e6\u05d8 \u05d0";
		const { container } = render(
			<div>{renderCitationWithTanachLinks(text, "cite")}</div>,
		);

		expect(container.textContent).toBe(text);
		expect(container.querySelector("a")).toBeNull();
	});

	it("ignores sefer-name prefixes that are not followed by whitespace", () => {
		const text = "\u05d1\u05e8\u05d0\u05e9\u05d9\u05eaX \u05d0";
		const { container } = render(
			<div>{renderCitationWithTanachLinks(text, "cite")}</div>,
		);

		expect(container.textContent).toBe(text);
		expect(container.querySelector("a")).toBeNull();
	});
});

describe("buildKetavVeKabbalah929PerushHref", () => {
	it("builds /929 perush URL with pasuk query for gematria pasuk", () => {
		const href = buildKetavVeKabbalah929PerushHref("בראשית", "לב", "כג");
		expect(href).not.toBeNull();
		expect(href).toMatch(/^\/929\/\d+\//);
		expect(href).toContain("pasuk=23");
		expect(href).toContain(encodeURIComponent(PERUSH_NAME_HAKTAV_VEKABBALAH));
	});

	it("builds /929 perush URL without pasuk query when pasuk is not gematria", () => {
		const href = buildKetavVeKabbalah929PerushHref(
			"בראשית",
			"לב",
			"not-a-pasuk",
		);

		expect(href).not.toBeNull();
		expect(href).not.toContain("pasuk=");
		expect(href).toContain(encodeURIComponent(PERUSH_NAME_HAKTAV_VEKABBALAH));
	});
	it("returns null when perek is out of range", () => {
		expect(
			buildKetavVeKabbalah929PerushHref(
				"\u05d1\u05e8\u05d0\u05e9\u05d9\u05ea",
				"\u05ea\u05ea\u05e7\u05e6\u05d8",
				"\u05d0",
			),
		).toBeNull();
	});

	it("omits pasuk query for whitespace-only pasuk input", () => {
		const href = buildKetavVeKabbalah929PerushHref(
			"\u05d1\u05e8\u05d0\u05e9\u05d9\u05ea",
			"\u05d0",
			"   ",
		);

		expect(href).not.toBeNull();
		expect(href).not.toContain("pasuk=");
	});
});

describe("renderFamilyTreeCitationLine", () => {
	it("falls back to ordinary Tanach links when the special citation has no pasuk", () => {
		const nodes = renderFamilyTreeCitationLine(
			"\u05d4\u05db\u05ea\u05d1 \u05d5\u05d4\u05e7\u05d1\u05dc\u05d4: \u05d1\u05e8\u05d0\u05e9\u05d9\u05ea \u05dc\u05d1",
			"cite",
		);
		render(<div>{nodes}</div>);

		const link = screen.getByRole("link", {
			name: "\u05d1\u05e8\u05d0\u05e9\u05d9\u05ea \u05dc\u05d1",
		});
		expect(link.getAttribute("href")).toMatch(/^\/929\/\d+$/);
	});

	it("links only the special citation span and renders prefix and suffix separately", () => {
		const line =
			"\u05dc\u05e4\u05e0\u05d9 \u05d4\u05db\u05ea\u05d1 \u05d5\u05d4\u05e7\u05d1\u05dc\u05d4 \u05e2\u05dc \u05d1\u05e8\u05d0\u05e9\u05d9\u05ea \u05dc\u05d1 \u05db\u05d2 \u05d0\u05d7\u05e8\u05d9 \u05d1\u05e8\u05d0\u05e9\u05d9\u05ea \u05d0";
		const nodes = renderFamilyTreeCitationLine(line, "cite");
		const { container } = render(<div>{nodes}</div>);

		expect(container.textContent).toBe(line);
		expect(
			screen.getByRole("link", {
				name: /\u05d4\u05db\u05ea\u05d1 \u05d5\u05d4\u05e7\u05d1\u05dc\u05d4.*\u05db\u05d2/,
			}),
		).toHaveAttribute(
			"href",
			expect.stringMatching(/\/929\/\d+\/.*pasuk=23$/),
		);
		expect(
			screen.getByRole("link", {
				name: "\u05d1\u05e8\u05d0\u05e9\u05d9\u05ea \u05d0",
			}),
		).toHaveAttribute("href", expect.stringMatching(/^\/929\/\d+$/));
	});
	it("links from הכתב והקבלה through the pasuk to 929 perush with pasuk query", () => {
		const line =
			"הכתב והקבלה (נשים מלאות לקידושין): בראשית לב כג";
		const expectedHref = buildKetavVeKabbalah929PerushHref(
			"בראשית",
			"לב",
			"כג",
		);
		const nodes = renderFamilyTreeCitationLine(line, "cite");
		const { container } = render(<div>{nodes}</div>);
		const links = container.querySelectorAll("a");
		expect(links.length).toBe(1);
		const a = links[0];
		expect(a?.getAttribute("href")).toBe(expectedHref);
		expect(a?.textContent).toBe(
			"הכתב והקבלה (נשים מלאות לקידושין): בראשית לב כג",
		);
	});
});

describe("renderFamilyTreeCitationLine fallback edge cases", () => {
	it("falls back when special phrase has no later Tanach reference", () => {
		const line =
			"\u05d1\u05e8\u05d0\u05e9\u05d9\u05ea \u05d0 \u05d5\u05d0\u05d6 \u05d4\u05db\u05ea\u05d1 \u05d5\u05d4\u05e7\u05d1\u05dc\u05d4";
		const { container } = render(
			<div>{renderFamilyTreeCitationLine(line, "cite")}</div>,
		);

		expect(container.textContent).toBe(line);
		expect(
			screen.getByRole("link", {
				name: "\u05d1\u05e8\u05d0\u05e9\u05d9\u05ea \u05d0 \u05d5\u05d0\u05d6",
			}),
		).toBeInTheDocument();
	});

	it("falls back when the special citation resolves no 929 href", () => {
		const line =
			"\u05d4\u05db\u05ea\u05d1 \u05d5\u05d4\u05e7\u05d1\u05dc\u05d4 \u05d1\u05e8\u05d0\u05e9\u05d9\u05ea \u05ea\u05ea\u05e7\u05e6\u05d8 \u05d0";
		const { container } = render(
			<div>{renderFamilyTreeCitationLine(line, "cite")}</div>,
		);

		expect(container.textContent).toBe(line);
		expect(container.querySelector("a")).toBeNull();
	});
});
