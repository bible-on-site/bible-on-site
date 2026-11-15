/**
 * @jest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { TABLET_MIN_WIDTH } from "@/hooks/useIsWideEnough";

jest.mock("@/app/components/Bookshelf/bookshelf.module.scss", () => ({
	root: "root",
	multiShelfContainer: "multiShelfContainer",
	shelfWrapper: "shelfWrapper",
	container: "container",
	surface: "surface",
	block: "block",
	book: "book",
	blockInner: "blockInner",
	back: "back",
	bottom: "bottom",
	front: "front",
	left: "left",
	right: "right",
	top: "top",
	spineLine: "spineLine",
	spineText: "spineText",
	spineDedication: "spineDedication",
	helekDedications: "helekDedications",
	helekDedicationStrip: "helekDedicationStrip",
	helekDedicationGroup: "helekDedicationGroup",
	bookmarkRibbon: "bookmarkRibbon",
	coverContent: "coverContent",
	coverTitle: "coverTitle",
	coverSubtitle: "coverSubtitle",
	shelfLabel: "shelfLabel",
}));

// Minimal sefarim covering all helek groups (Torah, Neviim Rishonim, Trei Asar, Ketuvim)
jest.mock("@/data/db/client-catalog.generated.json", () => ({
	books: [
		{ name: "בראשית", helek: "תורה", perekFrom: 1, perekTo: 50 },
		{ name: "שמות", helek: "תורה", perekFrom: 51, perekTo: 90 },
		{ name: "יהושע", helek: "נביאים", perekFrom: 91, perekTo: 120 },
		{ name: "עמוס", helek: "נביאים", perekFrom: 121, perekTo: 130 },
		{ name: "תהלים", helek: "כתובים", perekFrom: 131, perekTo: 180 },
	],
}));

jest.mock("@/data/perek-calendar", () => ({
	getTodaysPerekId: () => 5, // within בראשית (1-50)
}));

jest.mock("@/data/sefer-colors", () => ({
	isTreiAsar: (name: string) => name === "עמוס",
}));

import { Bookshelf } from "@/app/components/Bookshelf/Bookshelf";

describe("Bookshelf", () => {
	const originalInnerWidth = window.innerWidth;

	afterEach(() => {
		Object.defineProperty(window, "innerWidth", {
			value: originalInnerWidth,
			writable: true,
			configurable: true,
		});
	});

	describe("when narrow (multi-shelf layout)", () => {
		beforeEach(() => {
			Object.defineProperty(window, "innerWidth", {
				value: 800,
				writable: true,
				configurable: true,
			});
		});

		it("renders all sefer names", () => {
			render(<Bookshelf />);
			for (const name of ["בראשית", "שמות", "יהושע", "עמוס", "תהלים"]) {
				// Each name appears on the spine and the cover
				expect(screen.getAllByText(name).length).toBeGreaterThanOrEqual(1);
			}
		});

		it("renders per-helek shelf labels", () => {
			render(<Bookshelf />);
			expect(screen.getByText("תורה")).toBeInTheDocument();
			expect(screen.getByText("נביאים: ראשונים + גדולים")).toBeInTheDocument();
			expect(screen.getByText("נביאים (המשך): תרי עשר")).toBeInTheDocument();
			expect(screen.getByText("כתובים")).toBeInTheDocument();
		});

		it("sizes each shelf from its grouped book count", () => {
			const { container } = render(<Bookshelf />);
			const surfaces = Array.from(container.querySelectorAll(".surface"));

			expect(surfaces).toHaveLength(4);
			expect(surfaces.map((surface) => surface.getAttribute("style"))).toEqual([
				"width: 144px;",
				"width: 112px;",
				"width: 112px;",
				"width: 112px;",
			]);
		});

		it("calls onSeferClick with sefer name and perekFrom when a non-today book is clicked", () => {
			const onSeferClick = jest.fn();
			render(<Bookshelf onSeferClick={onSeferClick} />);
			// Find the שמות book (not today's sefer)
			const shmotButtons = screen
				.getAllByRole("button")
				.filter((btn) => btn.textContent?.includes("שמות"));
			fireEvent.click(shmotButtons[0]);
			expect(onSeferClick).toHaveBeenCalledTimes(1);
			// Non-today sefer should receive perekFrom (51 for שמות)
			expect(onSeferClick).toHaveBeenCalledWith("שמות", 51);
		});

		it("calls onSeferClick with todaysPerekId when today's sefer is clicked", () => {
			const onSeferClick = jest.fn();
			render(<Bookshelf onSeferClick={onSeferClick} />);
			// Find the בראשית book (today's sefer, perekId=5)
			const bereshitButtons = screen
				.getAllByRole("button")
				.filter((btn) => btn.textContent?.includes("בראשית"));
			fireEvent.click(bereshitButtons[0]);
			expect(onSeferClick).toHaveBeenCalledTimes(1);
			// Today's sefer should receive todaysPerekId (5), not perekFrom (1)
			expect(onSeferClick).toHaveBeenCalledWith("בראשית", 5);
		});

		it("renders today's sefer with a bookmark ribbon", () => {
			const { container } = render(<Bookshelf />);
			// Today's perekId 5 falls in בראשית → bookmarkRibbon class should appear
			// The Proxy mock maps styles.bookmarkRibbon → "bookmarkRibbon" in the DOM
			expect(container.innerHTML).toContain("bookmarkRibbon");
		});
	});

	describe("when wide (single-shelf layout)", () => {
		beforeEach(() => {
			Object.defineProperty(window, "innerWidth", {
				value: 1200,
				writable: true,
				configurable: true,
			});
		});

		it("renders all sefer names on a single shelf", () => {
			render(<Bookshelf />);
			for (const name of ["בראשית", "שמות", "יהושע", "עמוס", "תהלים"]) {
				expect(screen.getAllByText(name).length).toBeGreaterThanOrEqual(1);
			}
		});

		it("renders combined helek labels (נביאים without sub-group suffix)", () => {
			render(<Bookshelf />);
			// Single-shelf mode has simple helek labels
			expect(screen.getByText("נביאים")).toBeInTheDocument();
			expect(screen.getByText("תורה")).toBeInTheDocument();
			expect(screen.getByText("כתובים")).toBeInTheDocument();
		});
	});

	it("responds to window resize events", () => {
		Object.defineProperty(window, "innerWidth", {
			value: 1200,
			writable: true,
			configurable: true,
		});

		render(<Bookshelf />);
		// Initially wide → single shelf → "נביאים" label (no sub-group suffix)
		expect(screen.getByText("נביאים")).toBeInTheDocument();

		act(() => {
			Object.defineProperty(window, "innerWidth", {
				value: 800,
				writable: true,
				configurable: true,
			});
			window.dispatchEvent(new Event("resize"));
		});

		// After resize → narrow → multi-shelf labels appear
		expect(screen.getByText("נביאים: ראשונים + גדולים")).toBeInTheDocument();
	});

	it.each([390, 800])(
		"hydrates server HTML without mismatch at %ipx",
		async (width) => {
			// The server has no window; it renders the default 1200px layout
			Object.defineProperty(window, "innerWidth", {
				value: 1200,
				writable: true,
				configurable: true,
			});
			const html = renderToString(<Bookshelf />);
			Object.defineProperty(window, "innerWidth", {
				value: width,
				writable: true,
				configurable: true,
			});
			const container = document.createElement("div");
			container.append(
				...new DOMParser().parseFromString(html, "text/html").body.childNodes,
			);
			document.body.appendChild(container);
			const onRecoverableError = jest.fn();
			const consoleError = jest
				.spyOn(console, "error")
				.mockImplementation(() => {});

			await act(async () => {
				hydrateRoot(container, <Bookshelf />, { onRecoverableError });
			});

			expect(onRecoverableError).not.toHaveBeenCalled();
			expect(consoleError).not.toHaveBeenCalled();
			consoleError.mockRestore();
			// After mount the real (narrow) width switches to multi-shelf
			expect(container.textContent).toContain("נביאים: ראשונים + גדולים");
			container.remove();
		},
	);

	describe("with sefer dedications", () => {
		const dedications = {
			bySefer: { בראשית: ["לרפואת א", 'לע"נ ב'], שמות: ['לע"נ ג'] },
			byHelek: {},
		};

		it("joins a sefer's dedications on its spine line with the full text in the title", () => {
			render(<Bookshelf dedications={dedications} />);
			const caption = screen.getByText('לרפואת א · לע"נ ב');
			expect(caption).toHaveAttribute("title", 'לרפואת א\nלע"נ ב');
			expect(caption).toHaveClass("spineDedication");
			expect(caption.parentElement).toHaveTextContent("בראשית");
		});

		it("pads today's dedicated spine line more than others to clear the ribbon", () => {
			render(<Bookshelf dedications={dedications} />);
			const todayLine = screen.getByText('לרפואת א · לע"נ ב').parentElement;
			const otherLine = screen.getByText('לע"נ ג').parentElement;
			expect(todayLine?.getAttribute("style")).not.toEqual(
				otherLine?.getAttribute("style"),
			);
		});
	});

	describe("shelf dedication visibility (#2849 §1a)", () => {
		const dedications = {
			bySefer: { בראשית: ["לרפואת א"], תהלים: ['לע"נ כ'] },
			byHelek: { תורה: ['לע"נ ת'], נביאים: ["לרפואת נ"], כתובים: ['לע"נ כת'] },
		};

		const setWidth = (width: number) =>
			Object.defineProperty(window, "innerWidth", {
				value: width,
				writable: true,
				configurable: true,
			});

		const spineLineOf = (name: string) =>
			screen
				.getAllByText(name)
				.find((el) => el.classList.contains("spineText"))?.parentElement;

		it.each([390, 767])(
			"renders no dedication captions at %ipx (below the tablet boundary)",
			(width) => {
				setWidth(width);
				const { container } = render(<Bookshelf dedications={dedications} />);
				expect(container.querySelector(".spineDedication")).toBeNull();
				expect(container.querySelector(".helekDedications")).toBeNull();
				expect(container.querySelector(".helekDedicationStrip")).toBeNull();
				// Shelf content stays: names, helek labels and clickable books.
				expect(
					screen.getAllByText("בראשית").length,
				).toBeGreaterThanOrEqual(1);
				expect(screen.getByText("תורה")).toBeInTheDocument();
				expect(
					screen.getAllByRole("button").length,
				).toBeGreaterThanOrEqual(5);
			},
		);

		it("keeps book clicks working below the tablet boundary", () => {
			setWidth(390);
			const onSeferClick = jest.fn();
			render(
				<Bookshelf onSeferClick={onSeferClick} dedications={dedications} />,
			);
			const shmot = screen
				.getAllByRole("button")
				.find((btn) => btn.textContent?.includes("שמות"));
			// biome-ignore lint/style/noNonNullAssertion: שמות is in the mocked catalog
			fireEvent.click(shmot!);
			expect(onSeferClick).toHaveBeenCalledWith("שמות", 51);
		});

		it("leaves no extra spine padding on today's dedicated sefer below the boundary", () => {
			setWidth(390);
			render(<Bookshelf dedications={dedications} />);
			// בראשית is today's sefer: with the caption gated out, its spine
			// line uses the same padding as an undedicated sefer's.
			expect(spineLineOf("בראשית")?.getAttribute("style")).toEqual(
				spineLineOf("שמות")?.getAttribute("style"),
			);
		});

		it.each([768, 899])(
			"shows spine and per-shelf helek captions at %ipx (tablet multi-shelf)",
			(width) => {
				setWidth(width);
				const { container } = render(<Bookshelf dedications={dedications} />);
				// One spine caption per dedicated sefer (בראשית, תהלים).
				expect(
					container.querySelectorAll(".spineDedication").length,
				).toBeGreaterThanOrEqual(2);
				// 4 shelves: תורה + two נביאים shelves sharing the helek caption + כתובים.
				expect(
					container.querySelectorAll(".helekDedications").length,
				).toBeGreaterThanOrEqual(3);
				expect(container.querySelector(".helekDedicationStrip")).toBeNull();
			},
		);

		it.each([900, 1200])(
			"shows spine captions and the helek strip at %ipx (single shelf)",
			(width) => {
				setWidth(width);
				const { container } = render(<Bookshelf dedications={dedications} />);
				expect(
					container.querySelectorAll(".spineDedication").length,
				).toBeGreaterThanOrEqual(2);
				const strip = container.querySelector(".helekDedicationStrip");
				expect(strip).not.toBeNull();
				expect(
					strip?.querySelectorAll(".helekDedicationGroup").length,
				).toBe(3);
				expect(container.querySelector(".helekDedications")).toBeNull();
			},
		);

		it("drops and restores dedication captions across desktop -> phone -> desktop resizes", () => {
			setWidth(1200);
			const { container } = render(<Bookshelf dedications={dedications} />);
			expect(container.querySelector(".spineDedication")).not.toBeNull();

			act(() => {
				setWidth(390);
				window.dispatchEvent(new Event("resize"));
			});
			expect(container.querySelector(".spineDedication")).toBeNull();
			expect(container.querySelector(".helekDedicationStrip")).toBeNull();

			act(() => {
				setWidth(1200);
				window.dispatchEvent(new Event("resize"));
			});
			expect(container.querySelector(".spineDedication")).not.toBeNull();
			expect(container.querySelector(".helekDedicationStrip")).not.toBeNull();
		});
	});

	// The DOM-level gate above can only run after mount; the stylesheet must
	// also hide the captions during the desktop-default SSR/first render so a
	// phone never flashes dedication copy (#2849 §1a). jsdom cannot evaluate
	// media queries, so this asserts the rule directly in the module source.
	describe("bookshelf.module.scss", () => {
		const scss = readFileSync(
			resolve(
				process.cwd(),
				"src/app/components/Bookshelf/bookshelf.module.scss",
			),
			"utf8",
		);

		// `@media (<condition>) { ... }` blocks with their full bodies.
		const mediaBlocks = (() => {
			const blocks: { condition: string; body: string }[] = [];
			const re = /@media\s*(\([^)]*\))\s*\{/g;
			let match = re.exec(scss);
			while (match !== null) {
				let depth = 1;
				let i = re.lastIndex;
				while (i < scss.length && depth > 0) {
					if (scss[i] === "{") depth++;
					else if (scss[i] === "}") depth--;
					i++;
				}
				blocks.push({
					condition: match[1] ?? "",
					body: scss.slice(re.lastIndex, i - 1),
				});
				re.lastIndex = i;
				match = re.exec(scss);
			}
			return blocks;
		})();

		const isBelowTabletBoundary = (condition: string): boolean => {
			const range = condition.match(/width\s*<\s*([\d.]+)px/);
			if (range) return Number(range[1]) === TABLET_MIN_WIDTH;
			const max = condition.match(/max-width:\s*([\d.]+)px/);
			if (max) {
				const px = Number(max[1]);
				return px >= TABLET_MIN_WIDTH - 1 && px < TABLET_MIN_WIDTH;
			}
			return false;
		};

		it.each(["spineDedication", "helekDedications", "helekDedicationStrip"])(
			"hides .%s below the TABLET_MIN_WIDTH boundary",
			(cls) => {
				expect(
					mediaBlocks.some(
						(block) =>
							isBelowTabletBoundary(block.condition) &&
							block.body.includes(`.${cls}`) &&
							/display\s*:\s*none/.test(block.body),
					),
				).toBe(true);
			},
		);
	});
});
