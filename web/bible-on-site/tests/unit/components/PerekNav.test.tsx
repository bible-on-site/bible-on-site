/**
 * @jest-environment jsdom
 *
 * Render coverage for the על הפרק chapter navigation: canonical
 * previous/next links, crawlable hrefs, rel semantics, corpus-edge
 * placeholders, and the additional-book boundary labels (issue #2518).
 */
import { render, screen } from "@testing-library/react";
import { PerekNav } from "../../../src/app/929/[number]/components/PerekNav";
import { getPerekByPerekId } from "../../../src/data/perek-dto";

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		href,
		...rest
	}: {
		children: React.ReactNode;
		href: string;
	}) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

describe("PerekNav", () => {
	it("marks the landmark for assistive navigation", () => {
		render(<PerekNav prev={getPerekByPerekId(1)} next={getPerekByPerekId(3)} />);
		expect(
			screen.getByRole("navigation", { name: "ניווט בין פרקים" }),
		).toBeInTheDocument();
	});

	it("links previous and next perakim by canonical ids and sources", () => {
		render(<PerekNav prev={getPerekByPerekId(1)} next={getPerekByPerekId(3)} />);
		const prev = screen.getByRole("link", { name: /הפרק הקודם/ });
		const next = screen.getByRole("link", { name: /הפרק הבא/ });
		expect(prev).toHaveAttribute("href", "/929/1");
		expect(prev).toHaveAttribute("rel", "prev");
		expect(prev).toHaveTextContent("בראשית א");
		expect(next).toHaveAttribute("href", "/929/3");
		expect(next).toHaveAttribute("rel", "next");
		expect(next).toHaveTextContent("בראשית ג");
	});

	it("omits the previous link at the first perek", () => {
		const { container } = render(
			<PerekNav prev={null} next={getPerekByPerekId(2)} />,
		);
		expect(screen.queryByRole("link", { name: /הפרק הקודם/ })).toBeNull();
		expect(screen.getByRole("link", { name: /הפרק הבא/ })).toHaveAttribute(
			"href",
			"/929/2",
		);
		expect(container.querySelector("a[href='/929/0']")).toBeNull();
		expect(container.querySelectorAll("nav > span").length).toBe(1);
	});

	it("omits the next link at the last perek", () => {
		const { container } = render(
			<PerekNav prev={getPerekByPerekId(928)} next={null} />,
		);
		expect(screen.queryByRole("link", { name: /הפרק הבא/ })).toBeNull();
		expect(screen.getByRole("link", { name: /הפרק הקודם/ })).toHaveAttribute(
			"href",
			"/929/928",
		);
		expect(container.querySelector("a[href='/929/930']")).toBeNull();
	});

	it("keeps additional-book labels across the עזרא ע/עזרא נ boundary", () => {
		render(
			<PerekNav prev={getPerekByPerekId(851)} next={getPerekByPerekId(853)} />,
		);
		expect(screen.getByRole("link", { name: /הפרק הקודם/ })).toHaveTextContent(
			"עזרא ע י",
		);
		expect(screen.getByRole("link", { name: /הפרק הבא/ })).toHaveTextContent(
			"עזרא נ ב",
		);
	});
});
