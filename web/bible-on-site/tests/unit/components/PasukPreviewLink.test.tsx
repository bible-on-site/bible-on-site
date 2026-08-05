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

	it("parses perush query links including the perush name", () => {
		expect(
			parsePasukRefFromHref("/929/32/%D7%94%D7%9B%D7%AA%D7%91?pasuk=23"),
		).toEqual({ perekId: 32, pasuk: 23, perush: "הכתב" });
	});

	it("returns null for perek-only links", () => {
		expect(parsePasukRefFromHref("/929/29")).toBeNull();
	});

	it("returns null for non-tanach links", () => {
		expect(parsePasukRefFromHref("/pedia/x")).toBeNull();
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
		expect(fetchMock).toHaveBeenCalledWith("/api/tanah/pasuk/29/23");
	});

	it("requests and renders the perush note for perush citations", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				reference: 'הכתב והקבלה בראשית לב כ"ג',
				text: "פסוק",
				noteHtml: "<p>דברי הפירוש</p>",
			}),
		} as Response);
		render(
			<PasukPreviewLink href="/929/32/%D7%94%D7%9B%D7%AA%D7%91%20%D7%95%D7%94%D7%A7%D7%91%D7%9C%D7%94?pasuk=23">
				הכתב והקבלה בראשית לב כג
			</PasukPreviewLink>,
		);
		fireEvent.mouseEnter(
			screen.getByRole("link", { name: "הכתב והקבלה בראשית לב כג" }),
		);
		await waitFor(() => {
			expect(screen.getByRole("tooltip")).toHaveTextContent("דברי הפירוש");
		});
		expect(fetchMock).toHaveBeenCalledWith(
			`/api/tanah/pasuk/32/23?perush=${encodeURIComponent("הכתב והקבלה")}`,
		);
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

	it("caches a network failure and does not refetch", async () => {
		fetchMock.mockRejectedValue(new Error("offline"));
		render(<PasukPreviewLink href="/929/33#pasuk-4">בראשית לג ד</PasukPreviewLink>);
		const link = screen.getByRole("link", { name: "בראשית לג ד" });
		fireEvent.mouseEnter(link);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		fireEvent.mouseLeave(link);
		fireEvent.mouseEnter(link);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
	});

	it("serves repeat hovers from the cache", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "r", text: "קובץ" }),
		} as Response);
		render(<PasukPreviewLink href="/929/34#pasuk-5">בראשית לד ה</PasukPreviewLink>);
		const link = screen.getByRole("link", { name: "בראשית לד ה" });
		fireEvent.mouseEnter(link);
		await waitFor(() => expect(screen.getByRole("tooltip")).toBeInTheDocument());
		fireEvent.mouseLeave(link);
		await waitFor(() =>
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
		);
		fireEvent.mouseEnter(link);
		await waitFor(() => expect(screen.getByRole("tooltip")).toBeInTheDocument());
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("keeps the tooltip when re-hovering the link before the hide delay", async () => {
		jest.useFakeTimers();
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "r", text: "נשאר" }),
		} as Response);
		render(<PasukPreviewLink href="/929/35#pasuk-6">בראשית לה ו</PasukPreviewLink>);
		const link = screen.getByRole("link", { name: "בראשית לה ו" });
		fireEvent.mouseEnter(link);
		await waitFor(() => expect(screen.getByRole("tooltip")).toBeInTheDocument());
		fireEvent.mouseLeave(link);
		fireEvent.mouseEnter(link);
		jest.advanceTimersByTime(300);
		expect(screen.getByRole("tooltip")).toBeInTheDocument();
		jest.useRealTimers();
	});

	it("keeps the tooltip while the pointer is over it", async () => {
		jest.useFakeTimers();
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "r", text: "מרחף" }),
		} as Response);
		render(<PasukPreviewLink href="/929/36#pasuk-7">בראשית לו ז</PasukPreviewLink>);
		const link = screen.getByRole("link", { name: "בראשית לו ז" });
		fireEvent.mouseEnter(link);
		await waitFor(() => expect(screen.getByRole("tooltip")).toBeInTheDocument());
		fireEvent.mouseLeave(link);
		fireEvent.mouseEnter(screen.getByRole("tooltip"));
		jest.advanceTimersByTime(300);
		expect(screen.getByRole("tooltip")).toBeInTheDocument();
		fireEvent.mouseLeave(screen.getByRole("tooltip"));
		jest.advanceTimersByTime(300);
		await waitFor(() =>
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
		);
		jest.useRealTimers();
	});
});
