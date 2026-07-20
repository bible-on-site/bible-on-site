/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TanahpediaLink } from "../../../src/app/929/[number]/components/TanahpediaLink";

jest.mock("next/link", () => ({
	__esModule: true,
	default({
		href,
		children,
		className,
		onMouseEnter,
		onMouseLeave,
	}: {
		href: string;
		children: ReactNode;
		className?: string;
		onMouseEnter?: React.MouseEventHandler<HTMLAnchorElement>;
		onMouseLeave?: React.MouseEventHandler<HTMLAnchorElement>;
	}) {
		return (
			<a
				href={href}
				className={className}
				onMouseEnter={onMouseEnter}
				onMouseLeave={onMouseLeave}
			>
				{children}
			</a>
		);
	},
}));

function mockFetch(response: Partial<Response> | Promise<Partial<Response>>) {
	const fetchMock = jest.fn().mockResolvedValue(response);
	global.fetch = fetchMock as unknown as typeof fetch;
	return fetchMock;
}

async function hoverLink(link: HTMLElement, eventInit: MouseEventInit = {}) {
	await act(async () => {
		fireEvent.mouseEnter(link, eventInit);
		await Promise.resolve();
		await Promise.resolve();
	});
}

describe("TanahpediaLink", () => {
	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	it("links to the encoded entry and shows a fetched preview on hover", async () => {
		const linkLabel = "Moshe";
		const fetchMock = mockFetch({
			ok: true,
			json: async () => ({
				title: "Moshe Rabbeinu",
				snippet: "<strong>Leader</strong> of Israel",
			}),
		});

		render(
			<TanahpediaLink entryUniqueName="moshe rabbeinu" className="entity-link">
				{linkLabel}
			</TanahpediaLink>,
		);

		const link = screen.getByRole("link", { name: linkLabel });
		expect(link).toHaveAttribute(
			"href",
			"/tanahpedia/entry/moshe%20rabbeinu",
		);
		expect(link).toHaveClass("entity-link");

		await hoverLink(link, { clientX: 32, clientY: 48 });

		const tooltip = await screen.findByRole("tooltip");
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/tanahpedia/preview/moshe%20rabbeinu",
		);
		expect(tooltip).toHaveStyle({ left: "32px", top: "48px" });
		expect(screen.getByText("Moshe Rabbeinu")).toBeInTheDocument();
		expect(screen.getByText("Leader")).toBeInTheDocument();
	});

	it("keeps the preview open while the tooltip is hovered, then hides it after leaving", async () => {
		const linkLabel = "Miriam";
		mockFetch({
			ok: true,
			json: async () => ({
				title: "Miriam",
				snippet: "Prophetess",
			}),
		});

		render(
			<TanahpediaLink entryUniqueName="miriam">{linkLabel}</TanahpediaLink>,
		);

		const link = screen.getByRole("link", { name: linkLabel });
		await hoverLink(link, { clientX: 10, clientY: 12 });
		const tooltip = await screen.findByRole("tooltip");

		jest.useFakeTimers();
		fireEvent.mouseLeave(link);
		fireEvent.mouseEnter(tooltip);
		act(() => {
			jest.advanceTimersByTime(250);
		});
		expect(screen.getByRole("tooltip")).toBeInTheDocument();

		fireEvent.mouseLeave(tooltip);
		act(() => {
			jest.advanceTimersByTime(199);
		});
		expect(screen.getByRole("tooltip")).toBeInTheDocument();
		act(() => {
			jest.advanceTimersByTime(1);
		});
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});

	it("caches successful previews between hovers for the same entry", async () => {
		const linkLabel = "Aharon";
		const secondLinkLabel = "Aharon again";
		const fetchMock = mockFetch({
			ok: true,
			json: async () => ({
				title: "Aharon",
				snippet: "Kohen",
			}),
		});

		const { unmount } = render(
			<TanahpediaLink entryUniqueName="aharon">{linkLabel}</TanahpediaLink>,
		);
		await hoverLink(screen.getByRole("link", { name: linkLabel }));
		expect(await screen.findByRole("tooltip")).toHaveTextContent("Aharon");
		unmount();

		render(
			<TanahpediaLink entryUniqueName="aharon">{secondLinkLabel}</TanahpediaLink>,
		);
		await hoverLink(screen.getByRole("link", { name: secondLinkLabel }));

		expect(await screen.findByRole("tooltip")).toHaveTextContent("Aharon");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not render a tooltip when preview loading fails", async () => {
		const linkLabel = "No preview";
		const fetchMock = jest.fn().mockRejectedValue(new Error("offline"));
		global.fetch = fetchMock as unknown as typeof fetch;

		render(
			<TanahpediaLink entryUniqueName="no-preview">{linkLabel}</TanahpediaLink>,
		);

		await hoverLink(screen.getByRole("link", { name: linkLabel }));

		await expect(fetchMock).toHaveBeenCalledWith(
			"/api/tanahpedia/preview/no-preview",
		);
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});
});
