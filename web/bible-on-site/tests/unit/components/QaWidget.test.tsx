/**
 * @jest-environment jsdom
 */

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

import { act, fireEvent, render, screen } from "@testing-library/react";
import { QaWidget } from "../../../src/app/929/[number]/components/QaWidget";

const okResponse = {
	answers: [
		{
			text: "תשובה ראשונה",
			confidence: 0.85,
			source: {
				type: "perush",
				name: "רש\"י",
				author: "רש\"י",
				perekId: 5,
				perushSlug: "rashi",
				pasuk: 3,
				noteIdx: 1,
			},
		},
		{
			text: "תשובה שנייה",
			confidence: 0.5,
			source: {
				type: "article",
				name: "מאמר לדוגמא",
				author: "הרב כהן",
				perekId: 7,
				articleId: 42,
			},
		},
	],
	noAnswer: false,
};

function mockFetchJson(body: unknown) {
	(global.fetch as jest.Mock).mockResolvedValue({
		json: async () => body,
	});
}

function fetchBody(): Record<string, unknown> {
	const calls = (global.fetch as jest.Mock).mock.calls;
	expect(calls.length).toBe(1);
	return JSON.parse(calls[0][1].body as string) as Record<string, unknown>;
}

async function renderAndOpen() {
	render(<QaWidget perekId={5} seferPerekIds={[5, 6, 7]} />);
	const fab = await screen.findByRole("button", { name: "שאלה על הפרק" });
	fireEvent.click(fab);
	return fab;
}

async function ask(q = "מה אמר רש\"י?") {
	fireEvent.change(screen.getByLabelText("שאלה על הפרק"), {
		target: { value: q },
	});
	fireEvent.click(screen.getByRole("button", { name: "›" }));
	await act(async () => Promise.resolve());
}

describe("QaWidget", () => {
	beforeEach(() => {
		global.fetch = jest.fn();
		delete document.documentElement.dataset.bookView;
		document.body.innerHTML = "";
	});

	it("opens the panel from the FAB and closes on Escape", async () => {
		await renderAndOpen();
		expect(screen.getByText("שאלה על הפרק")).toBeTruthy();

		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByText("חיפוש במפרשים ובמאמרים")).toBeNull();
	});

	it("closes when the backdrop is clicked", async () => {
		await renderAndOpen();
		fireEvent.click(screen.getByRole("button", { name: "סגור" }));
		expect(screen.queryByText("חיפוש במפרשים ובמאמרים")).toBeNull();
	});

	it("toggles the panel via the qa-widget-toggle event", async () => {
		render(<QaWidget perekId={5} seferPerekIds={[5, 6, 7]} />);
		await screen.findByRole("button", { name: "שאלה על הפרק" });
		act(() => {
			document.dispatchEvent(new Event("qa-widget-toggle"));
		});
		expect(screen.getByText("חיפוש במפרשים ובמאמרים")).toBeTruthy();
	});

	it("sends perekIds=[perekId] for the default scope", async () => {
		mockFetchJson({ answers: [], noAnswer: true });
		await renderAndOpen();
		await ask();
		expect(fetchBody()).toEqual({ question: "מה אמר רש\"י?", perekIds: [5] });
	});

	it("sends seferPerekIds for the sefer scope", async () => {
		mockFetchJson({ answers: [], noAnswer: true });
		await renderAndOpen();
		fireEvent.click(screen.getByLabelText("בספר זה"));
		await ask();
		expect(fetchBody()).toEqual({
			question: "מה אמר רש\"י?",
			perekIds: [5, 6, 7],
		});
	});

	it("omits perekIds for the all-Tanah scope", async () => {
		mockFetchJson({ answers: [], noAnswer: true });
		await renderAndOpen();
		fireEvent.click(screen.getByLabelText('בכל התנ"ך'));
		await ask();
		expect(fetchBody()).toEqual({ question: "מה אמר רש\"י?" });
	});

	it("does not send a request for a blank question", async () => {
		mockFetchJson({ answers: [], noAnswer: true });
		await renderAndOpen();
		const send = screen.getByRole("button", { name: "›" }) as HTMLButtonElement;
		expect(send.disabled).toBe(true);
		fireEvent.click(send);
		await act(async () => Promise.resolve());
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("submits on Enter inside the input", async () => {
		mockFetchJson({ answers: [], noAnswer: true });
		await renderAndOpen();
		const input = screen.getByLabelText("שאלה על הפרק");
		fireEvent.change(input, { target: { value: "שאלה" } });
		fireEvent.keyDown(input, { key: "Enter" });
		await act(async () => Promise.resolve());
		expect(global.fetch).toHaveBeenCalledTimes(1);
	});

	it("renders answers with citation links and confidence", async () => {
		mockFetchJson(okResponse);
		await renderAndOpen();
		await ask();

		expect(screen.getByText("תשובה ראשונה")).toBeTruthy();
		expect(screen.getByText("תשובה שנייה")).toBeTruthy();
		expect(screen.getByText("0.85")).toBeTruthy();
		expect(screen.getByText("0.50")).toBeTruthy();

		const links = screen.getAllByRole("link");
		expect(links.map((l) => l.getAttribute("href"))).toEqual([
			"/929/5/rashi#note-ג-2",
			"/929/7/42",
		]);
	});

	it("links a perush answer without a pasuk to the perush page", async () => {
		mockFetchJson({
			answers: [
				{
					text: "תשובה",
					confidence: 0.7,
					source: {
						type: "perush",
						name: "רמב\"ן",
						author: "רמב\"ן",
						perekId: 5,
						perushSlug: "ramban",
					},
				},
			],
			noAnswer: false,
		});
		await renderAndOpen();
		await ask();
		expect(screen.getByRole("link")).toHaveAttribute(
			"href",
			"/929/5/ramban",
		);
	});

	it("falls back to the perek page for unknown source types", async () => {
		mockFetchJson({
			answers: [
				{
					text: "תשובה",
					confidence: 0.4,
					source: {
						type: "unknown-kind",
						name: "מקור",
						author: "מחבר",
						perekId: 8,
					},
				},
			],
			noAnswer: false,
		});
		await renderAndOpen();
		await ask();
		const link = screen.getByRole("link");
		expect(link).toHaveAttribute("href", "/929/8");
		expect(link.textContent).toContain("unknown-kind: מקור");
	});

	it("shows the empty state when noAnswer is true", async () => {
		mockFetchJson({ answers: [], noAnswer: true });
		await renderAndOpen();
		await ask();
		expect(screen.getByText("לא נמצאו תשובות מתאימות.")).toBeTruthy();
	});

	it("shows the empty state when the request fails", async () => {
		(global.fetch as jest.Mock).mockRejectedValue(new Error("network down"));
		await renderAndOpen();
		await ask();
		expect(screen.getByText("לא נמצאו תשובות מתאימות.")).toBeTruthy();
	});

	it("trims the question before sending", async () => {
		mockFetchJson({ answers: [], noAnswer: true });
		await renderAndOpen();
		await ask("   שאלה עם רווחים   ");
		expect(fetchBody().question).toBe("שאלה עם רווחים");
	});

	describe("in book view", () => {
		beforeEach(() => {
			document.documentElement.dataset.bookView = "";
		});

		it("hides the FAB", async () => {
			render(<QaWidget perekId={5} seferPerekIds={[5, 6, 7]} />);
			await act(async () => Promise.resolve());
			expect(
				screen.queryByRole("button", { name: "שאלה על הפרק" }),
			).toBeNull();
		});

		it("dispatches qa-navigate-sefer on citation click and closes", async () => {
			mockFetchJson(okResponse);
			const events: CustomEvent[] = [];
			document.addEventListener("qa-navigate-sefer", (e) =>
				events.push(e as CustomEvent),
			);

			render(<QaWidget perekId={5} seferPerekIds={[5, 6, 7]} />);
			await act(async () => Promise.resolve());
			act(() => {
				document.dispatchEvent(new Event("qa-widget-toggle"));
			});

			fireEvent.change(screen.getByLabelText("שאלה על הפרק"), {
				target: { value: "שאלה" },
			});
			fireEvent.click(screen.getByRole("button", { name: "›" }));
			await act(async () => Promise.resolve());

			fireEvent.click(screen.getByText('פירוש: רש"י — פסוק ג'));
			expect(events).toHaveLength(1);
			expect(events[0].detail.perekId).toBe(5);
			expect(screen.queryByText("חיפוש במפרשים ובמאמרים")).toBeNull();
		});
	});
});
