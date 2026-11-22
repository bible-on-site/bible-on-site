/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TanahpediaEntryPreview } from "../../../src/app/components/TanahpediaEntryPreview";
import {
	anchorFullyClipped,
	computePreviewPosition,
	entityPreviewLink,
	entityPreviewPointerEnabled,
	previewSnippetChildren,
	previewUniqueNameFromHref,
} from "../../../src/app/components/tanahpedia-entry-preview";
import { toPreviewHtml } from "../../../src/lib/tanahpedia/preview-format";

function setPointerCapable(matches: boolean) {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		writable: true,
		value: jest.fn().mockReturnValue({ matches }),
	});
}

function mockFetchJson(data: { title: string; snippet: string }) {
	const fetchMock = jest.fn().mockResolvedValue({
		ok: true,
		json: async () => data,
	});
	global.fetch = fetchMock as unknown as typeof fetch;
	return fetchMock;
}

function entityAnchor(uniqueName: string, label = "entity") {
	return (
		<a
			href={`/pedia/${encodeURIComponent(uniqueName)}`}
			data-tanahpedia-entry={uniqueName}
		>
			{label}
		</a>
	);
}

async function hover(element: Element) {
	await act(async () => {
		fireEvent.mouseOver(element);
	});
}

async function focus(element: HTMLElement) {
	await act(async () => {
		element.focus();
	});
}

/** jsdom would log a "navigation not implemented" error on real clicks. */
function preventLinkNavigation() {
	document.addEventListener("click", (e) => e.preventDefault());
}

describe("entityPreviewLink", () => {
	it("finds a marked TanahpediaLink anchor and its nested children", () => {
		const anchor = document.createElement("a");
		anchor.href = "/pedia/x";
		anchor.dataset.tanahpediaEntry = "x";
		const child = document.createElement("span");
		anchor.appendChild(child);
		document.body.appendChild(anchor);

		expect(entityPreviewLink(child)).toBe(anchor);
		expect(entityPreviewLink(anchor)).toBe(anchor);
		anchor.remove();
	});

	it("finds a pipeline-injected mention anchor", () => {
		const anchor = document.createElement("a");
		anchor.href = "/pedia/y";
		anchor.className = "tanahpedia-mention";
		document.body.appendChild(anchor);

		expect(entityPreviewLink(anchor)).toBe(anchor);
		anchor.remove();
	});

	it("returns null for plain anchors, non-matches and non-elements", () => {
		const anchor = document.createElement("a");
		anchor.href = "/pedia/x";
		document.body.appendChild(anchor);

		expect(entityPreviewLink(anchor)).toBeNull();
		expect(entityPreviewLink(document.createElement("div"))).toBeNull();
		expect(entityPreviewLink(document.createTextNode("t"))).toBeNull();
		expect(entityPreviewLink(null)).toBeNull();
		anchor.remove();
	});
});

describe("previewUniqueNameFromHref", () => {
	it("decodes the entry name from a /pedia href", () => {
		expect(
			previewUniqueNameFromHref("http://localhost/pedia/moshe%20rabbeinu"),
		).toBe("moshe rabbeinu");
		expect(previewUniqueNameFromHref("/pedia/%D7%99%D7%A2%D7%A7%D7%91")).toBe(
			"יעקב",
		);
		expect(previewUniqueNameFromHref("http://localhost/pedia/name/")).toBe(
			"name",
		);
	});

	it("returns null for non-entry paths and malformed hrefs", () => {
		expect(previewUniqueNameFromHref("http://localhost/929/1")).toBeNull();
		expect(previewUniqueNameFromHref("http://localhost/pedia/")).toBeNull();
		expect(previewUniqueNameFromHref("http://localhost/pedia/a/b")).toBeNull();
	});

	it("warns and returns null for unparseable and malformed hrefs", () => {
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		expect(previewUniqueNameFromHref("http://[")).toBeNull();
		expect(
			previewUniqueNameFromHref("http://localhost/pedia/%E0%A4%A"),
		).toBeNull();
		expect(warn).toHaveBeenCalledTimes(2);
	});
});

describe("entityPreviewPointerEnabled", () => {
	it("mirrors the hover/fine-pointer media query", () => {
		const win = (matches: boolean) => ({
			matchMedia: () => ({ matches }),
		});
		expect(entityPreviewPointerEnabled(win(true))).toBe(true);
		expect(entityPreviewPointerEnabled(win(false))).toBe(false);
	});
});

describe("previewSnippetChildren", () => {
	it("rebuilds text, headings and breaks as elements", () => {
		const { container } = render(
			<div>{previewSnippetChildren("lead<h2>Title</h2>mid<br>tail")}</div>,
		);

		expect(container.innerHTML).toBe(
			"<div>lead<h2>Title</h2>mid<br>tail</div>",
		);
	});

	it("renders every allowed heading level", () => {
		const { container } = render(
			<div>{previewSnippetChildren("<h3>a</h3><h4>b</h4>")}</div>,
		);

		expect(container.innerHTML).toBe("<div><h3>a</h3><h4>b</h4></div>");
	});

	it("decodes entities and degrades unexpected markup to text", () => {
		const { container } = render(
			<div>
				{previewSnippetChildren(
					'a&amp;b<script>alert(1)</script><b onmouseover="x()">bold</b><!-- note -->',
				)}
			</div>,
		);

		expect(container.querySelector("script, b")).toBeNull();
		expect(container.textContent).toBe("a&balert(1)bold");
	});

	it("renders real toPreviewHtml output tag-for-tag", () => {
		// Drift detector: jest.setup mocks DOMPurify as a passthrough, so the
		// input stays inside the formatter's own allowlist vocabulary; the
		// round-trip then fails the moment the API emits a tag the renderer
		// cannot rebuild.
		const snippet = toPreviewHtml(
			"<p>Intro<sup>1</sup> text</p><h2>שמו</h2><h3>משנה</h3><h4>קטן</h4><hr><p>More words</p>",
		);
		const { container } = render(
			<div>{previewSnippetChildren(snippet)}</div>,
		);

		expect(container.firstElementChild?.innerHTML).toBe(snippet);
	});
});

describe("anchorFullyClipped", () => {
	function stubRect(element: Element, rect: Partial<DOMRect>) {
		return jest
			.spyOn(element, "getBoundingClientRect")
			.mockReturnValue(rect as DOMRect);
	}

	it("reports an anchor scrolled out of its clipping container", () => {
		const clipper = document.createElement("div");
		clipper.style.overflowY = "auto";
		const anchor = document.createElement("a");
		clipper.appendChild(anchor);
		document.body.appendChild(clipper);
		stubRect(clipper, { top: 0, bottom: 100, left: 0, right: 100 });
		stubRect(anchor, { top: -50, bottom: -10, left: 0, right: 10 });

		expect(anchorFullyClipped(anchor)).toBe(true);
		clipper.remove();
	});

	it("keeps visible anchors and non-clipping ancestors unclipped", () => {
		const outer = document.createElement("div");
		const clipper = document.createElement("div");
		clipper.style.overflow = "auto";
		const anchor = document.createElement("a");
		clipper.appendChild(anchor);
		outer.appendChild(clipper);
		document.body.appendChild(outer);
		stubRect(clipper, { top: 0, bottom: 100, left: 0, right: 100 });
		stubRect(anchor, { top: 10, bottom: 20, left: 0, right: 10 });

		expect(anchorFullyClipped(anchor)).toBe(false);
		outer.remove();
	});

	it("ignores a static zero-height shell outside an absolute reader's clip chain", () => {
		// The perek reader is absolutely positioned, so the PageShell
		// overflow:hidden wrapper that contains no in-flow height never
		// clips it - only the reader's own scroll box does.
		const shell = document.createElement("div");
		shell.style.overflow = "hidden";
		const reader = document.createElement("div");
		reader.style.position = "absolute";
		reader.style.overflowY = "auto";
		const anchor = document.createElement("a");
		reader.appendChild(anchor);
		shell.appendChild(reader);
		document.body.appendChild(shell);
		stubRect(shell, { top: 0, bottom: 0, left: 0, right: 0 });
		stubRect(reader, { top: 0, bottom: 200, left: 0, right: 500 });
		const anchorRect = stubRect(anchor, {
			top: 10,
			bottom: 20,
			left: 0,
			right: 10,
		});

		expect(anchorFullyClipped(anchor)).toBe(false);

		// Scrolled out of the reader's own box, the link is still clipped.
		anchorRect.mockReturnValue({
			top: -50,
			bottom: -10,
			left: 0,
			right: 10,
		} as DOMRect);
		expect(anchorFullyClipped(anchor)).toBe(true);
		shell.remove();
	});

	it("clips through a static scroller above the reader's containing block", () => {
		// A static overflow ancestor that wraps the reader's containing block
		// still clips: it clips the positioned wrapper the reader hangs off,
		// and that clip carries down to the anchor.
		const scroller = document.createElement("div");
		scroller.style.overflowY = "auto";
		const wrapper = document.createElement("div");
		wrapper.style.position = "relative";
		const reader = document.createElement("div");
		reader.style.position = "absolute";
		reader.style.overflowY = "auto";
		const anchor = document.createElement("a");
		reader.appendChild(anchor);
		wrapper.appendChild(reader);
		scroller.appendChild(wrapper);
		document.body.appendChild(scroller);
		stubRect(scroller, { top: 0, bottom: 100, left: 0, right: 500 });
		stubRect(wrapper, { top: 0, bottom: 300, left: 0, right: 500 });
		stubRect(reader, { top: 0, bottom: 300, left: 0, right: 500 });
		const anchorRect = stubRect(anchor, {
			top: 150,
			bottom: 170,
			left: 0,
			right: 10,
		});

		// Inside the reader and wrapper but below the outer scroller's box.
		expect(anchorFullyClipped(anchor)).toBe(true);

		// Visible inside every box, no clip applies.
		anchorRect.mockReturnValue({
			top: 50,
			bottom: 70,
			left: 0,
			right: 10,
		} as DOMRect);
		expect(anchorFullyClipped(anchor)).toBe(false);
		scroller.remove();
	});
});

describe("computePreviewPosition", () => {
	const viewport = { width: 1024, height: 768 };

	it("places the popover below the anchor, horizontally centered", () => {
		const pos = computePreviewPosition(
			{ top: 100, bottom: 110, left: 100, width: 40 },
			{ width: 200, height: 100 },
			viewport,
		);
		expect(pos).toEqual({ x: 20, y: 120 });
	});

	it("flips above the anchor when there is no room below", () => {
		const pos = computePreviewPosition(
			{ top: 600, bottom: 700, left: 100, width: 40 },
			{ width: 200, height: 100 },
			viewport,
		);
		expect(pos).toEqual({ x: 20, y: 490 });
	});

	it("clamps the horizontal position inside the viewport", () => {
		const right = computePreviewPosition(
			{ top: 0, bottom: 20, left: 1000, width: 40 },
			{ width: 200, height: 50 },
			viewport,
		);
		expect(right.x).toBe(816);
		const left = computePreviewPosition(
			{ top: 0, bottom: 20, left: 0, width: 10 },
			{ width: 200, height: 50 },
			viewport,
		);
		expect(left.x).toBe(8);
	});

	it("keeps the popover on the roomier side when neither fits fully", () => {
		const aboveRoomier = computePreviewPosition(
			{ top: 100, bottom: 140, left: 0, width: 10 },
			{ width: 100, height: 120 },
			{ width: 400, height: 150 },
		);
		expect(aboveRoomier.y).toBe(8);
		const belowRoomier = computePreviewPosition(
			{ top: 10, bottom: 20, left: 0, width: 10 },
			{ width: 100, height: 280 },
			{ width: 400, height: 300 },
		);
		expect(belowRoomier.y).toBe(12);
	});

	it("keeps the margin when the popover exceeds the viewport", () => {
		const pos = computePreviewPosition(
			{ top: 0, bottom: 20, left: 500, width: 10 },
			{ width: 2000, height: 50 },
			viewport,
		);
		expect(pos.x).toBe(8);
	});

	it("honours custom gap and margin", () => {
		const pos = computePreviewPosition(
			{ top: 100, bottom: 110, left: 100, width: 40 },
			{ width: 200, height: 100 },
			viewport,
			{ gap: 0, margin: 0 },
		);
		expect(pos).toEqual({ x: 20, y: 110 });
	});
});

describe("TanahpediaEntryPreview", () => {
	beforeEach(() => {
		setPointerCapable(true);
	});

	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	it("shows the fetched preview next to a hovered entity link", async () => {
		const fetchMock = mockFetchJson({
			title: "Moshe Rabbeinu",
			snippet: "<h2>Leader</h2>",
		});
		render(
			<>
				<TanahpediaEntryPreview />
				{entityAnchor("hover-entry", "Moshe")}
			</>,
		);
		const link = screen.getByRole("link", { name: "Moshe" });

		await hover(link);

		const tip = await screen.findByRole("tooltip");
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/tanahpedia/preview/hover-entry",
		);
		expect(tip).toHaveTextContent("Moshe Rabbeinu");
		expect(tip).toHaveTextContent("Leader");
		expect(link).toHaveAttribute("aria-describedby", tip.id);
		// jsdom rects are all zero - the position is the clamped default.
		expect(tip).toHaveStyle({ left: "8px", top: "10px" });
	});

	it("previews a pipeline-injected mention anchor from its href", async () => {
		const label = "mention";
		mockFetchJson({ title: "ישראל", snippet: "Nation" });
		render(
			<>
				<TanahpediaEntryPreview />
				<a
					className="tanahpedia-mention"
					href={`/pedia/${encodeURIComponent("mention-entry")}`}
				>
					{label}
				</a>
			</>,
		);

		await hover(screen.getByRole("link", { name: "mention" }));

		expect(await screen.findByRole("tooltip")).toHaveTextContent("ישראל");
	});

	it("opens on keyboard focus and dismisses on Escape and blur", async () => {
		mockFetchJson({ title: "Focused", snippet: "Snippet" });
		render(
			<>
				<TanahpediaEntryPreview />
				{entityAnchor("focus-entry", "Focused link")}
			</>,
		);
		const link = screen.getByRole("link", { name: "Focused link" });

		await focus(link);
		expect(await screen.findByRole("tooltip")).toHaveTextContent("Focused");

		await act(async () => {
			fireEvent.keyDown(document, { key: "Escape" });
		});
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

		// The link keeps focus after Escape - blur first to refire focusin.
		await act(async () => {
			link.blur();
		});
		await focus(link);
		expect(await screen.findByRole("tooltip")).toBeInTheDocument();
		jest.useFakeTimers();
		await act(async () => {
			link.blur();
		});
		expect(screen.getByRole("tooltip")).toBeInTheDocument();
		act(() => jest.advanceTimersByTime(200));
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});

	it("hides after the pointer leaves and stays while the anchor is focused", async () => {
		mockFetchJson({ title: "H", snippet: "s" });
		render(
			<>
				<TanahpediaEntryPreview />
				{entityAnchor("leave-entry", "Leave")}
			</>,
		);
		const link = screen.getByRole("link", { name: "Leave" });

		await focus(link);
		await hover(link);
		expect(await screen.findByRole("tooltip")).toBeInTheDocument();

		jest.useFakeTimers();
		// Pointer leaves while the link still holds focus - preview stays.
		fireEvent.mouseOut(link, { relatedTarget: document.body });
		act(() => jest.advanceTimersByTime(300));
		expect(screen.getByRole("tooltip")).toBeInTheDocument();

		// Blur while hovered - the pointer keeps it open.
		fireEvent.mouseOver(link);
		await act(async () => {
			link.blur();
		});
		act(() => jest.advanceTimersByTime(300));
		expect(screen.getByRole("tooltip")).toBeInTheDocument();

		// Pointer out and not focused - hides only after the grace delay.
		fireEvent.mouseOut(link, { relatedTarget: document.body });
		act(() => jest.advanceTimersByTime(199));
		expect(screen.getByRole("tooltip")).toBeInTheDocument();
		act(() => jest.advanceTimersByTime(1));
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});

	it("keeps the preview while the pointer is inside the popover", async () => {
		mockFetchJson({ title: "P", snippet: "s" });
		render(
			<>
				<TanahpediaEntryPreview />
				{entityAnchor("popover-entry", "Pop")}
			</>,
		);
		const link = screen.getByRole("link", { name: "Pop" });

		await hover(link);
		const tip = await screen.findByRole("tooltip");

		jest.useFakeTimers();
		// Pointer crosses onto the popover - no hide is scheduled.
		fireEvent.mouseOut(link, { relatedTarget: tip });
		fireEvent.mouseOver(tip);
		act(() => jest.advanceTimersByTime(300));
		expect(screen.getByRole("tooltip")).toBeInTheDocument();

		// Moving between popover children ignores the leave.
		const title = tip.querySelector("div");
		expect(title).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		fireEvent.mouseOut(tip, { relatedTarget: title! });
		fireEvent.mouseOver(tip);
		act(() => jest.advanceTimersByTime(300));
		expect(screen.getByRole("tooltip")).toBeInTheDocument();

		// Re-entering the link inside the grace delay cancels the pending hide.
		fireEvent.mouseOut(tip, { relatedTarget: document.body });
		act(() => jest.advanceTimersByTime(100));
		fireEvent.mouseOver(link);
		act(() => jest.advanceTimersByTime(300));
		expect(screen.getByRole("tooltip")).toBeInTheDocument();

		fireEvent.mouseOut(link, { relatedTarget: document.body });
		act(() => jest.advanceTimersByTime(200));
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});

	it("keeps the preview when the pointer leaves the popover while the anchor is focused", async () => {
		mockFetchJson({ title: "PF", snippet: "s" });
		render(
			<>
				<TanahpediaEntryPreview />
				{entityAnchor("focus-popover-entry", "FocusPop")}
			</>,
		);
		const link = screen.getByRole("link", { name: "FocusPop" });

		await focus(link);
		const tip = await screen.findByRole("tooltip");

		jest.useFakeTimers();
		fireEvent.mouseOver(tip);
		fireEvent.mouseOut(tip, { relatedTarget: document.body });
		act(() => jest.advanceTimersByTime(300));
		expect(screen.getByRole("tooltip")).toBeInTheDocument();
	});

	it("keeps a focus-opened preview across the browser's focus scroll", async () => {
		const resolvers = new Map<string, (value: unknown) => void>();
		global.fetch = jest.fn(
			(url: string) =>
				new Promise((resolve) => {
					resolvers.set(url, resolve);
				}),
		) as unknown as typeof fetch;
		render(
			<>
				<TanahpediaEntryPreview />
				{entityAnchor("scroll-focus-entry", "Offscreen")}
			</>,
		);
		const link = screen.getByRole("link", { name: "Offscreen" });

		// Tab reaches an offscreen link: the browser scrolls it into view
		// while the preview fetch is still in flight.
		await focus(link);
		fireEvent.scroll(document);
		const resolve = resolvers.get(
			"/api/tanahpedia/preview/scroll-focus-entry",
		);
		if (!resolve) throw new Error("preview fetch was not issued");
		await act(async () =>
			resolve({
				ok: true,
				json: async () => ({ title: "Late", snippet: "s" }),
			}),
		);
		expect(await screen.findByRole("tooltip")).toBeInTheDocument();

		// A later manual scroll re-anchors the still-focused preview: the
		// popover follows the link's new rect rather than keeping stale
		// coordinates.
		const rect = jest
			.spyOn(link, "getBoundingClientRect")
			.mockReturnValue({ top: 200, bottom: 210, left: 50, width: 20 } as DOMRect);
		fireEvent.scroll(document);
		const tip = screen.getByRole("tooltip");
		expect(tip).toHaveStyle({ top: "220px" });
		rect.mockReturnValue({
			top: 300,
			bottom: 310,
			left: 50,
			width: 20,
		} as DOMRect);
		fireEvent.scroll(document);
		expect(tip).toHaveStyle({ top: "320px" });
	});

	it("hides a focused preview while its link is clipped out, then re-shows it", async () => {
		mockFetchJson({ title: "Clip", snippet: "s" });
		render(
			<>
				<TanahpediaEntryPreview />
				<div id="clip" style={{ overflowY: "auto" }}>
					{entityAnchor("clipped-entry", "Clipped")}
				</div>
			</>,
		);
		const link = screen.getByRole("link", { name: "Clipped" });
		const clipBox = document.getElementById("clip");
		if (!clipBox) throw new Error("clip container missing");
		jest.spyOn(clipBox, "getBoundingClientRect").mockReturnValue({
			top: 0,
			bottom: 200,
			left: 0,
			right: 500,
		} as DOMRect);
		const rect = jest
			.spyOn(link, "getBoundingClientRect")
			.mockReturnValue({
				top: 60,
				bottom: 70,
				left: 50,
				right: 70,
				width: 20,
			} as DOMRect);

		await focus(link);
		expect(await screen.findByRole("tooltip")).toBeInTheDocument();

		// Scrolling the container carries the focused link out of its box:
		// the popover stays mounted and described but is no longer visible.
		rect.mockReturnValue({
			top: -60,
			bottom: -10,
			left: 50,
			right: 70,
			width: 20,
		} as DOMRect);
		await act(async () => {
			fireEvent.scroll(clipBox);
		});
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		expect(
			document.getElementById("tanahpedia-entry-preview"),
		).not.toBeVisible();
		expect(link).toHaveAttribute(
			"aria-describedby",
			"tanahpedia-entry-preview",
		);

		// Scrolling it back into view re-anchors the same preview.
		rect.mockReturnValue({
			top: 80,
			bottom: 90,
			left: 50,
			right: 70,
			width: 20,
		} as DOMRect);
		await act(async () => {
			fireEvent.scroll(clipBox);
		});
		expect(await screen.findByRole("tooltip")).toBeInTheDocument();
	});

	it("does not leak hover state when focus moves the preview to another link", async () => {
		mockFetchJson({ title: "T", snippet: "s" });
		render(
			<>
				<TanahpediaEntryPreview />
				{entityAnchor("hovered-entry", "Hovered")}
				{entityAnchor("focused-entry", "Focused")}
			</>,
		);
		const hovered = screen.getByRole("link", { name: "Hovered" });
		const focused = screen.getByRole("link", { name: "Focused" });

		// The pointer still rests on the first link when Tab focuses the next.
		await hover(hovered);
		await focus(focused);
		expect(await screen.findByRole("tooltip")).toBeInTheDocument();

		jest.useFakeTimers();
		await act(async () => {
			focused.blur();
		});
		act(() => jest.advanceTimersByTime(200));
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});

	it("closes on click and on scroll", async () => {
		preventLinkNavigation();
		mockFetchJson({ title: "C", snippet: "s" });
		render(
			<>
				<TanahpediaEntryPreview />
				{entityAnchor("click-entry", "Click")}
				{entityAnchor("scroll-entry", "Scroll")}
			</>,
		);
		const clickLink = screen.getByRole("link", { name: "Click" });
		const scrollLink = screen.getByRole("link", { name: "Scroll" });

		await hover(clickLink);
		expect(await screen.findByRole("tooltip")).toBeInTheDocument();
		await act(async () => {
			fireEvent.click(clickLink);
		});
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

		await hover(scrollLink);
		expect(await screen.findByRole("tooltip")).toBeInTheDocument();
		await act(async () => {
			fireEvent.scroll(document);
		});
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});

	it("stays silent on touch-primary devices", async () => {
		setPointerCapable(false);
		const fetchMock = mockFetchJson({ title: "T", snippet: "s" });
		render(
			<>
				<TanahpediaEntryPreview />
				{entityAnchor("touch-entry", "Touch")}
			</>,
		);
		const link = screen.getByRole("link", { name: "Touch" });

		await hover(link);
		await focus(link);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});

	it("ignores non-entity targets and stale fetches", async () => {
		const resolvers = new Map<string, (value: unknown) => void>();
		global.fetch = jest.fn(
			(url: string) =>
				new Promise((resolve) => {
					resolvers.set(url, resolve);
				}),
		) as unknown as typeof fetch;
		const orphanLabel = "orphan";
		const plainLabel = "plain";
		render(
			<>
				<TanahpediaEntryPreview />
				<a href="/elsewhere" data-tanahpedia-entry="orphan">
					{orphanLabel}
				</a>
				{entityAnchor("first-entry", "First")}
				{entityAnchor("second-entry", "Second")}
				<a href="/elsewhere">{plainLabel}</a>
			</>,
		);
		const orphan = screen.getByRole("link", { name: "orphan" });
		const first = screen.getByRole("link", { name: "First" });
		const second = screen.getByRole("link", { name: "Second" });
		const plain = screen.getByRole("link", { name: "plain" });

		// Marker without a resolvable /pedia href - no fetch, no preview.
		await hover(orphan);
		expect(global.fetch).not.toHaveBeenCalled();

		// Plain anchors, foreign events and non-Escape keys do nothing.
		await hover(plain);
		fireEvent.mouseOut(orphan, { relatedTarget: document.body });
		fireEvent.mouseOut(plain, { relatedTarget: document.body });
		fireEvent.focusIn(plain);
		fireEvent.focusOut(plain);
		fireEvent.focusOut(orphan);
		fireEvent.click(document.body);
		fireEvent.keyDown(document, { key: "Enter" });
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

		// Switch anchors before the first fetch resolves - its data is dropped.
		await hover(first);
		await hover(second);
		const resolveFirst = resolvers.get("/api/tanahpedia/preview/first-entry");
		const resolveSecond = resolvers.get("/api/tanahpedia/preview/second-entry");
		if (!resolveFirst || !resolveSecond) {
			throw new Error("preview fetches were not issued");
		}
		await act(async () =>
			resolveFirst({
				ok: true,
				json: async () => ({ title: "First", snippet: "s" }),
			}),
		);
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		await act(async () =>
			resolveSecond({
				ok: true,
				json: async () => ({ title: "Second", snippet: "s" }),
			}),
		);
		expect(await screen.findByRole("tooltip")).toHaveTextContent("Second");
	});

	it("caches successful and missing previews", async () => {
		preventLinkNavigation();
		const fetchMock = mockFetchJson({ title: "Cached", snippet: "s" });
		render(
			<>
				<TanahpediaEntryPreview />
				{entityAnchor("cache-entry", "One")}
				{entityAnchor("cache-entry", "Two")}
			</>,
		);

		await hover(screen.getByRole("link", { name: "One" }));
		expect(await screen.findByRole("tooltip")).toHaveTextContent("Cached");
		await act(async () => {
			fireEvent.click(screen.getByRole("link", { name: "One" }));
		});

		await hover(screen.getByRole("link", { name: "Two" }));
		expect(await screen.findByRole("tooltip")).toHaveTextContent("Cached");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not render a preview when the fetch fails or misses", async () => {
		preventLinkNavigation();
		const fetchMock = jest.fn().mockResolvedValue({ ok: false });
		global.fetch = fetchMock as unknown as typeof fetch;
		render(
			<>
				<TanahpediaEntryPreview />
				{entityAnchor("missing-entry", "Missing")}
			</>,
		);

		await hover(screen.getByRole("link", { name: "Missing" }));
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/tanahpedia/preview/missing-entry",
		);
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

		// The miss is cached - a second hover does not refetch.
		await act(async () => {
			fireEvent.click(screen.getByRole("link", { name: "Missing" }));
		});
		await hover(screen.getByRole("link", { name: "Missing" }));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not render a preview when the fetch rejects", async () => {
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		global.fetch = jest
			.fn()
			.mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
		render(
			<>
				<TanahpediaEntryPreview />
				{entityAnchor("reject-entry", "Reject")}
			</>,
		);

		await hover(screen.getByRole("link", { name: "Reject" }));
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});
