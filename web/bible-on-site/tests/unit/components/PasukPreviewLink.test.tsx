/**
 * @jest-environment jsdom
 */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type ComponentProps, forwardRef } from "react";
import {
	PasukPreviewLink,
	parsePasukRefFromHref,
} from "../../../src/app/pedia/components/PasukPreviewLink";

jest.mock("next/link", () => ({
	__esModule: true,
	default: forwardRef<HTMLAnchorElement, ComponentProps<"a">>(function LinkMock(
		{ href, children, ...rest },
		ref,
	) {
		return (
			<a href={href} ref={ref} {...rest}>
				{children}
			</a>
		);
	}),
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

	it("parses perush-search links carrying extra query params", () => {
		expect(
			parsePasukRefFromHref(
				"/929/1/%D7%A8%D7%A9%D7%99?pasuk=3&note=0&q=%D7%A4%D7%A1%D7%95%D7%A7",
			),
		).toEqual({ perekId: 1, pasuk: 3, perush: "רשי", note: 0 });
	});

	it("captures the note index of perush-search links", () => {
		expect(
			parsePasukRefFromHref("/929/1/%D7%A8%D7%A9%D7%99?pasuk=3&note=2"),
		).toEqual({ perekId: 1, pasuk: 3, perush: "רשי", note: 2 });
	});

	it("parses pasuk anywhere in the query params", () => {
		expect(parsePasukRefFromHref("/929/1?note=0&pasuk=3")).toEqual({
			perekId: 1,
			pasuk: 3,
			note: 0,
		});
	});

	it("returns null for query links without a pasuk param", () => {
		expect(parsePasukRefFromHref("/929/1/some-article?q=x")).toBeNull();
	});

	it("returns null when pasuk is only a suffix of another param", () => {
		expect(parsePasukRefFromHref("/929/1?other-pasuk=3")).toBeNull();
	});

	it("returns null when the pasuk value is not bare digits", () => {
		expect(parsePasukRefFromHref("/929/1?pasuk=3abc")).toBeNull();
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
			json: async () => ({ reference: 'בראשית כט כ"ג', text: "וַיְהִי בָעֶרֶב" }),
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

	it("shows the pasuk preview for perush-search hrefs with extra params", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				reference: "רשי בראשית א ג",
				text: "וַיִּקְרָא",
				noteHtml: "<p>הערת רשי</p>",
			}),
		} as Response);
		render(
			<PasukPreviewLink href="/929/1/%D7%A8%D7%A9%D7%99?pasuk=3&note=2&q=x">
				רשי בראשית א ג
			</PasukPreviewLink>,
		);
		fireEvent.mouseEnter(screen.getByRole("link", { name: "רשי בראשית א ג" }));
		await waitFor(() => {
			expect(screen.getByRole("tooltip")).toHaveTextContent("הערת רשי");
		});
		expect(fetchMock).toHaveBeenCalledWith(
			`/api/tanah/pasuk/1/3?perush=${encodeURIComponent("רשי")}&note=2`,
		);
	});

	it("hides the tooltip after mouse leave", async () => {
		jest.useFakeTimers();
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "r", text: "t" }),
		} as Response);
		render(
			<PasukPreviewLink href="/929/30#pasuk-4">בראשית ל ד</PasukPreviewLink>,
		);
		const link = screen.getByRole("link", { name: "בראשית ל ד" });
		await act(async () => {
			fireEvent.mouseEnter(link);
		});
		await waitFor(() =>
			expect(screen.getByRole("tooltip")).toBeInTheDocument(),
		);
		fireEvent.mouseLeave(link);
		act(() => jest.advanceTimersByTime(300));
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
		render(
			<PasukPreviewLink href="/929/31#pasuk-2">בראשית לא ב</PasukPreviewLink>,
		);
		fireEvent.mouseEnter(screen.getByRole("link", { name: "בראשית לא ב" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});

	it("retries a rejected fetch on the next hover", async () => {
		fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "r", text: "נסיון חוזר" }),
		} as Response);
		render(
			<PasukPreviewLink href="/929/33#pasuk-4">בראשית לג ד</PasukPreviewLink>,
		);
		const link = screen.getByRole("link", { name: "בראשית לג ד" });
		await act(async () => {
			fireEvent.mouseEnter(link);
		});
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		fireEvent.mouseLeave(link);
		await act(async () => {
			fireEvent.mouseEnter(link);
		});
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(screen.getByRole("tooltip")).toBeInTheDocument(),
		);
	});

	it("retries a non-ok response on the next hover", async () => {
		fetchMock
			.mockResolvedValueOnce({
				ok: false,
				json: async () => null,
			} as Response)
			.mockResolvedValue({
				ok: true,
				json: async () => ({ reference: "r", text: "נסיון חוזר" }),
			} as Response);
		render(
			<PasukPreviewLink href="/929/36#pasuk-7">בראשית לו ז</PasukPreviewLink>,
		);
		const link = screen.getByRole("link", { name: "בראשית לו ז" });
		await act(async () => {
			fireEvent.mouseEnter(link);
		});
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		fireEvent.mouseLeave(link);
		await act(async () => {
			fireEvent.mouseEnter(link);
		});
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(screen.getByRole("tooltip")).toBeInTheDocument(),
		);
	});

	it("serves repeat hovers from the cache", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "r", text: "קובץ" }),
		} as Response);
		render(
			<PasukPreviewLink href="/929/34#pasuk-5">בראשית לד ה</PasukPreviewLink>,
		);
		const link = screen.getByRole("link", { name: "בראשית לד ה" });
		await act(async () => {
			fireEvent.mouseEnter(link);
		});
		await waitFor(() =>
			expect(screen.getByRole("tooltip")).toBeInTheDocument(),
		);
		fireEvent.mouseLeave(link);
		await waitFor(() =>
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
		);
		await act(async () => {
			fireEvent.mouseEnter(link);
		});
		await waitFor(() =>
			expect(screen.getByRole("tooltip")).toBeInTheDocument(),
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("keeps the tooltip when re-hovering the link before the hide delay", async () => {
		jest.useFakeTimers();
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "r", text: "נשאר" }),
		} as Response);
		render(
			<PasukPreviewLink href="/929/35#pasuk-6">בראשית לה ו</PasukPreviewLink>,
		);
		const link = screen.getByRole("link", { name: "בראשית לה ו" });
		await act(async () => {
			fireEvent.mouseEnter(link);
		});
		await waitFor(() =>
			expect(screen.getByRole("tooltip")).toBeInTheDocument(),
		);
		fireEvent.mouseLeave(link);
		await act(async () => {
			fireEvent.mouseEnter(link);
		});
		act(() => jest.advanceTimersByTime(300));
		expect(screen.getByRole("tooltip")).toBeInTheDocument();
		jest.useRealTimers();
	});

	it("keeps the tooltip while the pointer is over it", async () => {
		jest.useFakeTimers();
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "r", text: "מרחף" }),
		} as Response);
		render(
			<PasukPreviewLink href="/929/36#pasuk-7">בראשית לו ז</PasukPreviewLink>,
		);
		const link = screen.getByRole("link", { name: "בראשית לו ז" });
		await act(async () => {
			fireEvent.mouseEnter(link);
		});
		await waitFor(() =>
			expect(screen.getByRole("tooltip")).toBeInTheDocument(),
		);
		fireEvent.mouseLeave(link);
		fireEvent.mouseEnter(screen.getByRole("tooltip"));
		act(() => jest.advanceTimersByTime(300));
		expect(screen.getByRole("tooltip")).toBeInTheDocument();
		fireEvent.mouseLeave(screen.getByRole("tooltip"));
		act(() => jest.advanceTimersByTime(300));
		await waitFor(() =>
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
		);
		jest.useRealTimers();
	});

	it("positions the tooltip inside the viewport below a top-edge anchor", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "r", text: "קצה" }),
		} as Response);
		render(
			<PasukPreviewLink href="/929/41#pasuk-3">בראשית מא ג</PasukPreviewLink>,
		);
		const link = screen.getByRole("link", { name: "בראשית מא ג" });
		jest.spyOn(link, "getBoundingClientRect").mockReturnValue({
			top: 4,
			bottom: 20,
			left: 200,
			width: 60,
			right: 260,
			height: 16,
			x: 200,
			y: 4,
			toJSON: () => ({}),
		} as DOMRect);
		fireEvent.mouseEnter(link);
		// jsdom measures the tooltip at 0x0; with the anchor hugging the top
		// edge it lands 10px below the anchor instead of clipping above the
		// viewport.
		await waitFor(() =>
			expect(screen.getByRole("tooltip")).toHaveStyle({
				top: "30px",
				left: "230px",
			}),
		);
	});

	it("dismisses the tooltip on scroll", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "r", text: "גלילה" }),
		} as Response);
		render(
			<PasukPreviewLink href="/929/42#pasuk-5">בראשית מב ה</PasukPreviewLink>,
		);
		fireEvent.mouseEnter(screen.getByRole("link", { name: "בראשית מב ה" }));
		await screen.findByRole("tooltip");
		act(() => {
			fireEvent.scroll(document);
		});
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});

	it("dismisses the tooltip on window resize", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "r", text: "שינוי" }),
		} as Response);
		render(
			<PasukPreviewLink href="/929/43#pasuk-7">בראשית מג ז</PasukPreviewLink>,
		);
		fireEvent.mouseEnter(screen.getByRole("link", { name: "בראשית מג ז" }));
		await screen.findByRole("tooltip");
		act(() => {
			fireEvent(window, new Event("resize"));
		});
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});

	it("closes immediately on scroll while a hide is pending", async () => {
		jest.useFakeTimers();
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "r", text: "מיידי" }),
		} as Response);
		render(
			<PasukPreviewLink href="/929/44#pasuk-8">בראשית מד ח</PasukPreviewLink>,
		);
		const link = screen.getByRole("link", { name: "בראשית מד ח" });
		await act(async () => {
			fireEvent.mouseEnter(link);
		});
		await waitFor(() =>
			expect(screen.getByRole("tooltip")).toBeInTheDocument(),
		);
		fireEvent.mouseLeave(link);
		act(() => {
			fireEvent.scroll(document);
		});
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		jest.useRealTimers();
	});

	it("clears a pending hide timer when the link unmounts", () => {
		jest.useFakeTimers();
		const { unmount } = render(
			<PasukPreviewLink href="/929/46#pasuk-1">בראשית מו א</PasukPreviewLink>,
		);
		const timerCount = jest.getTimerCount();
		fireEvent.mouseLeave(screen.getByRole("link"));
		expect(jest.getTimerCount()).toBe(timerCount + 1);
		unmount();
		expect(jest.getTimerCount()).toBe(timerCount);
		jest.useRealTimers();
	});

	it("keeps an oversized tooltip open when its own content scrolls", async () => {
		const innerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
		Object.defineProperty(window, "innerHeight", {
			value: 300,
			configurable: true,
		});
		// jsdom reports offsetHeight 0; fake a tall tooltip that reflows to
		// its capped height once maxHeight lands.
		const heightSpy = jest
			.spyOn(HTMLElement.prototype, "offsetHeight", "get")
			.mockImplementation(function (this: HTMLElement) {
				return this.style.maxHeight
					? Number.parseInt(this.style.maxHeight, 10)
					: 600;
			});
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: "r", text: "כבדה" }),
		} as Response);
		render(
			<PasukPreviewLink href="/929/45#pasuk-2">בראשית מה ב</PasukPreviewLink>,
		);
		const link = screen.getByRole("link", { name: "בראשית מה ב" });
		jest.spyOn(link, "getBoundingClientRect").mockReturnValue({
			top: 100,
			bottom: 116,
			left: 200,
			width: 60,
			right: 260,
			height: 16,
			x: 200,
			y: 100,
			toJSON: () => ({}),
		} as DOMRect);
		fireEvent.mouseEnter(link);
		await waitFor(() =>
			expect(screen.getByRole("tooltip")).toHaveStyle({
				maxHeight: "166px",
				top: "126px",
			}),
		);
		const tooltip = screen.getByRole("tooltip");
		fireEvent.scroll(tooltip);
		expect(tooltip).toBeVisible();
		heightSpy.mockRestore();
		if (innerHeight) {
			Object.defineProperty(window, "innerHeight", innerHeight);
		}
	});

	it("keeps a preview entered directly without a pending hide timer", async () => {
		const label = "בראשית לז א";
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ reference: label, text: "פסוק" }),
		} as Response);
		render(<PasukPreviewLink href="/929/37#pasuk-1">{label}</PasukPreviewLink>);
		await act(async () => {
			fireEvent.mouseEnter(screen.getByRole("link", { name: label }));
		});
		const tooltip = await screen.findByRole("tooltip");
		fireEvent.mouseEnter(tooltip);
		expect(tooltip).toBeVisible();
	});
});
