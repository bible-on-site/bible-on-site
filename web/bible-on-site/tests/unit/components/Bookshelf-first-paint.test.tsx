/** @jest-environment jsdom */
import { act, fireEvent, render } from "@testing-library/react";
import { Profiler } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

jest.mock("@/app/components/Bookshelf/bookshelf.module.scss", () => ({
	root: "root",
	multiShelfContainer: "multiShelfContainer",
	shelfWrapper: "shelfWrapper",
	container: "container",
	surface: "surface",
	block: "block",
	book: "book",
}));
jest.mock("@/data/perek-calendar", () => ({ getTodaysPerekId: () => 125 }));

import { Bookshelf } from "@/app/components/Bookshelf/Bookshelf";

const originalWidth = window.innerWidth;
const setWidth = (width: number) => {
	Object.defineProperty(window, "innerWidth", {
		value: width,
		configurable: true,
		writable: true,
	});
};
const layout = (container: HTMLElement) =>
	Array.from(
		container.querySelectorAll<HTMLElement>(".surface"),
		(surface) => surface.style.width,
	);

afterEach(() => setWidth(originalWidth));

it.each([1350, 600])(
	"uses the %ipx viewport on the first client-only commit",
	(width) => {
		setWidth(width);
		const container = document.createElement("div");
		document.body.append(container);
		const commits: string[][] = [];
		render(
			<Profiler id="shelf" onRender={() => commits.push(layout(container))}>
				<Bookshelf />
			</Profiler>,
			{ container },
		);
		expect(commits.length).toBeGreaterThan(0);
		expect(commits[0]).toHaveLength(width < 900 ? 4 : 1);
		// The initial commit must not flash a different shelf count or size.
		expect(commits[0]).toEqual(commits.at(-1));
	},
);

it("keeps responding to viewport changes after mounting", () => {
	setWidth(1350);
	const { container } = render(<Bookshelf />);
	const wide = layout(container);
	expect(wide).toHaveLength(1);
	act(() => {
		setWidth(600);
		fireEvent(window, new Event("resize"));
	});
	expect(layout(container)).toHaveLength(4);
	act(() => {
		setWidth(1350);
		fireEvent(window, new Event("resize"));
	});
	expect(layout(container)).toEqual(wide);
});

it("hydrates the deterministic server shelf before adopting the viewport", async () => {
	setWidth(600);
	const container = document.createElement("div");
	const serverDocument = new DOMParser().parseFromString(
		renderToString(<Bookshelf />),
		"text/html",
	);
	container.replaceChildren(...serverDocument.body.childNodes);
	document.body.append(container);
	expect(layout(container)).toHaveLength(1);
	const serverRoot = container.firstChild;
	const recoverableErrors: unknown[] = [];
	let root: ReturnType<typeof hydrateRoot> | undefined;
	try {
		await act(async () => {
			root = hydrateRoot(container, <Bookshelf />, {
				onRecoverableError: (error) => recoverableErrors.push(error),
			});
		});
		expect(recoverableErrors).toEqual([]);
		expect(container.firstChild).toBe(serverRoot);
		expect(layout(container)).toHaveLength(4);
	} finally {
		act(() => root?.unmount());
		container.remove();
	}
});
