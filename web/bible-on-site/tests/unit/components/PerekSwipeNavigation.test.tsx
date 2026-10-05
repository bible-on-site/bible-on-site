/** @jest-environment jsdom */
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import PerekSwipeNavigation from "@/app/929/[number]/components/PerekSwipeNavigation";

let pathname = "/929/2";
const push = jest.fn();
const router = { push };
jest.mock("next/navigation", () => ({
	usePathname: () => pathname,
	useRouter: () => router,
}));

function point(x: number, y = 100, identifier = 1) {
	return { identifier, clientX: x, clientY: y };
}

function emit(
	target: Element,
	type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
	touches: ReturnType<typeof point>[],
	changedTouches = touches,
	time = 100,
) {
	const event = createEvent[type](target, { touches, changedTouches });
	Object.defineProperty(event, "timeStamp", { value: time });
	fireEvent(target, event);
	return event;
}

function swipe(
	target: Element,
	from = point(100),
	to = point(250),
	duration = 200,
) {
	emit(target, "touchStart", [from]);
	emit(target, "touchMove", [to], [to], 150);
	return emit(target, "touchEnd", [], [to], 100 + duration);
}

function Reader() {
	return (
		<PerekSwipeNavigation className="perek-layout">
			<article data-testid="text">Chapter text</article>
			<a href="/pedia/example">Citation</a>
			<button type="button">Settings</button>
			<input aria-label="Volume" type="range" />
			<div data-testid="editable" contentEditable />
			<dialog open data-testid="dialog">
				<span>Dialog content</span>
			</dialog>
			<div data-testid="carousel" style={{ overflowX: "auto" }}>
				<span data-testid="card">Carousel card</span>
			</div>
		</PerekSwipeNavigation>
	);
}

beforeEach(() => {
	pathname = "/929/2";
	delete document.documentElement.dataset.bookView;
	window.getSelection()?.removeAllRanges();
});

test.each([
	[100, 250, "/929/3"],
	[250, 100, "/929/1"],
])("navigates one chapter in RTL direction (%i to %i)", (from, to, href) => {
	render(<Reader />);
	const end = swipe(screen.getByTestId("text"), point(from), point(to));
	expect(push).toHaveBeenCalledTimes(1);
	expect(push).toHaveBeenCalledWith(href);
	expect(end.defaultPrevented).toBe(true);
});

test("mouse drags and pen pointer events never navigate", () => {
	render(<Reader />);
	const text = screen.getByTestId("text");
	fireEvent.mouseDown(text, { clientX: 100, clientY: 100 });
	fireEvent.mouseMove(text, { clientX: 250, clientY: 100, buttons: 1 });
	fireEvent.mouseUp(text, { clientX: 250, clientY: 100 });
	for (const pointerType of ["mouse", "pen"]) {
		fireEvent.pointerDown(text, { pointerType, clientX: 100, clientY: 100 });
		fireEvent.pointerMove(text, { pointerType, clientX: 250, clientY: 100 });
		fireEvent.pointerUp(text, { pointerType, clientX: 250, clientY: 100 });
	}
	expect(push).not.toHaveBeenCalled();
});

test.each([
	[point(100), point(100), 200, "tap"],
	[point(100), point(140), 200, "short drag"],
	[point(100), point(120, 250), 200, "vertical scroll"],
	[point(100), point(200, 200), 200, "diagonal scroll"],
	[point(100), point(250), 1000, "long press"],
	[point(5), point(250), 200, "left browser edge"],
	[point(innerWidth - 5), point(100), 200, "right browser edge"],
])("preserves %s to %s (%i ms): %s", (from, to, duration) => {
	render(<Reader />);
	expect(
		swipe(screen.getByTestId("text"), from, to, duration).defaultPrevented,
	).toBe(false);
	expect(push).not.toHaveBeenCalled();
});

test("a vertical scroll cannot turn into chapter navigation later in the gesture", () => {
	render(<Reader />);
	const text = screen.getByTestId("text");
	emit(text, "touchStart", [point(100)]);
	emit(text, "touchMove", [point(105, 120)]);
	emit(text, "touchMove", [point(250, 130)]);
	emit(text, "touchEnd", [], [point(250, 130)]);
	expect(push).not.toHaveBeenCalled();
});

test.each(["link", "button", "slider"])(
	"leaves %s interactions alone",
	(role) => {
		render(<Reader />);
		swipe(screen.getByRole(role));
		expect(push).not.toHaveBeenCalled();
	},
);

test.each(["editable", "dialog"])("leaves %s interactions alone", (testId) => {
	render(<Reader />);
	swipe(
		screen.getByTestId(testId).firstElementChild ?? screen.getByTestId(testId),
	);
	expect(push).not.toHaveBeenCalled();
});

test("preserves a horizontal carousel gesture even when it starts on a card", () => {
	render(<Reader />);
	const carousel = screen.getByTestId("carousel");
	Object.defineProperties(carousel, {
		scrollWidth: { value: 600 },
		clientWidth: { value: 300 },
	});
	swipe(screen.getByTestId("card"));
	expect(push).not.toHaveBeenCalled();
});

test("supports swipes on text inside containers that do not overflow", () => {
	render(<Reader />);
	swipe(screen.getByTestId("card"));
	expect(push).toHaveBeenCalledWith("/929/3");
});

test.each(["start", "release"])("preserves selected text at %s", (phase) => {
	render(<Reader />);
	const text = screen.getByTestId("text");
	const select = () => {
		const range = document.createRange();
		range.selectNodeContents(text);
		window.getSelection()?.addRange(range);
	};
	if (phase === "start") select();
	emit(text, "touchStart", [point(100)]);
	if (phase === "release") select();
	emit(text, "touchEnd", [], [point(250)]);
	expect(push).not.toHaveBeenCalled();
});

test("leaves the book view's gestures to the flipbook", () => {
	render(<Reader />);
	document.documentElement.dataset.bookView = "";
	swipe(screen.getByTestId("text"));
	expect(push).not.toHaveBeenCalled();
});

test.each(["start", "move"])(
	"cancels multi-touch at %s, including after one finger lifts",
	(phase) => {
		render(<Reader />);
		const text = screen.getByTestId("text");
		const fingers = [point(100), point(200, 100, 2)];
		emit(text, "touchStart", phase === "start" ? fingers : [fingers[0]]);
		if (phase === "move") emit(text, "touchMove", fingers);
		emit(text, "touchEnd", [fingers[0]], [fingers[1]]);
		emit(text, "touchEnd", [], [point(250)]);
		expect(push).not.toHaveBeenCalled();
	},
);

test("cancelled touches and mismatched fingers cannot navigate; a new swipe still works", () => {
	render(<Reader />);
	const text = screen.getByTestId("text");
	emit(text, "touchStart", [point(100)]);
	emit(text, "touchCancel", []);
	emit(text, "touchEnd", [], [point(250)]);
	emit(text, "touchStart", [point(100)]);
	emit(text, "touchEnd", [], [point(250, 100, 2)]);
	expect(push).not.toHaveBeenCalled();
	swipe(text);
	expect(push).toHaveBeenCalledWith("/929/3");
});

test.each([
	["/929/1", 250, 100],
	["/929/929", 100, 250],
	["/929/930", 250, 100],
	["/929/0", 100, 250],
	["/929/sefer-cover", 100, 250],
])("does not navigate outside the chapter list from %s", (path, from, to) => {
	pathname = path;
	render(<Reader />);
	swipe(screen.getByTestId("text"), point(from), point(to));
	expect(push).not.toHaveBeenCalled();
});

test("updates after route changes and ignores repeated swipes during navigation", () => {
	const { rerender } = render(<Reader />);
	swipe(screen.getByTestId("text"));
	swipe(screen.getByTestId("text"));
	expect(push).toHaveBeenCalledTimes(1);
	pathname = "/929/3";
	rerender(<Reader />);
	swipe(screen.getByTestId("text"));
	expect(push).toHaveBeenLastCalledWith("/929/4");
});

test("navigates from expanded content to the adjacent chapter's text view", () => {
	pathname = "/929/2/commentary";
	render(<Reader />);
	swipe(screen.getByTestId("text"));
	expect(push).toHaveBeenCalledWith("/929/3");
});

test("removes touch listeners when the reader unmounts", () => {
	const { unmount } = render(<Reader />);
	const text = screen.getByTestId("text");
	unmount();
	swipe(text);
	expect(push).not.toHaveBeenCalled();
});
