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
});

describe("buildKetavVeKabbalah929PerushHref", () => {
	it("builds /929 perush URL with pasuk query for gematria pasuk", () => {
		const href = buildKetavVeKabbalah929PerushHref("בראשית", "לב", "כג");
		expect(href).not.toBeNull();
		expect(href).toMatch(/^\/929\/\d+\//);
		expect(href).toContain("pasuk=23");
		expect(href).toContain(encodeURIComponent(PERUSH_NAME_HAKTAV_VEKABBALAH));
	});
});

describe("renderFamilyTreeCitationLine", () => {
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
