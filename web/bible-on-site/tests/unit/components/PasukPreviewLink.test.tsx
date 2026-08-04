/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
	parsePasukRefFromHref,
	PasukPreviewLink,
} from "../../../src/app/tanahpedia/components/PasukPreviewLink";

jest.mock("next/link", () => ({
	__esModule: true,
	default({
		href,
		children,
		...rest
	}: { href: string; children: React.ReactNode } & Record<string, unknown>) {
		return (
			<a href={href} {...rest}>
				{children}
			</a>
		);
	},
}));

describe("parsePasukRefFromHref", () => {
	it("parses perek anchors", () => {
		expect(parsePasukRefFromHref("/929/29#pasuk-23")).toEqual({
			perekId: 29,
			pasuk: 23,
		});
	});

	it("parses perush query links", () => {
		expect(
			parsePasukRefFromHref("/929/32/%D7%94%D7%9B%D7%AA%D7%91?pasuk=23"),
		).toEqual({ perekId: 32, pasuk: 23 });
	});

	it("returns null for perek-only links", () => {
		expect(parsePasukRefFromHref("/929/29")).toBeNull();
	});

	it("returns null for non-tanach links", () => {
		expect(parsePasukRefFromHref("/tanahpedia/entry/x")).toBeNull();
	});
});

describe("PasukPreviewLink", () => {
	let fetchMock: jest.Mock;

	beforeEach(() => {
		fetchMock = jest.fn();
		(global as { fetch: unknown }).fetch = fetchMock;
	});

	afterEach(() => {
		(global as { fetch?: unknown }).fetch = undefined;
	});

	it("shows the pasuk preview tooltip on hover", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "בראשית כט כ\"ג", text: "וַיְהִי בָעֶרֶב" }),
		} as Response);
		render(
			<PasukPreviewLink href="/929/29#pasuk-23">בראשית כט כג</PasukPreviewLink>,
		);
		fireEvent.mouseEnter(screen.getByRole("link", { name: "בראשית כט כג" }));
		await waitFor(() => {
			expect(screen.getByRole("tooltip")).toHaveTextContent("וַיְהִי בָעֶרֶב");
		});
	});

	it("hides the tooltip after mouse leave", async () => {
		jest.useFakeTimers();
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "r", text: "t" }),
		} as Response);
		render(<PasukPreviewLink href="/929/30#pasuk-4">בראשית ל ד</PasukPreviewLink>);
		const link = screen.getByRole("link", { name: "בראשית ל ד" });
		fireEvent.mouseEnter(link);
		await waitFor(() => expect(screen.getByRole("tooltip")).toBeInTheDocument());
		fireEvent.mouseLeave(link);
		jest.advanceTimersByTime(300);
		await waitFor(() =>
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
		);
		jest.useRealTimers();
	});

	it("renders a plain link without preview for perek-only hrefs", () => {
		render(<PasukPreviewLink href="/929/29">בראשית כט</PasukPreviewLink>);
		fireEvent.mouseEnter(screen.getByRole("link", { name: "בראשית כט" }));
		expect(fetchMock).not.toHaveBeenCalled();
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});

	it("shows no tooltip when the preview endpoint fails", async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			json: async () => null,
		} as Response);
		render(<PasukPreviewLink href="/929/31#pasuk-2">בראשית לא ב</PasukPreviewLink>);
		fireEvent.mouseEnter(screen.getByRole("link", { name: "בראשית לא ב" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});
});
