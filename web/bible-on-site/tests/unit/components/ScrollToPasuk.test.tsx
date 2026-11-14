import { act, render } from "@testing-library/react";
import { ScrollToPasuk } from "@/app/929/[number]/components/ScrollToPasuk";

let mockSearchParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
	useSearchParams: () => mockSearchParams,
}));

beforeEach(() => {
	jest.useFakeTimers();
	window.history.replaceState(null, "", "/929/197#pasuk-23");
	const article = document.createElement("article");
	for (const number of [1, 3, 23]) {
		const verse = document.createElement("span");
		verse.id = `pasuk-${number}`;
		verse.scrollIntoView = jest.fn();
		article.appendChild(verse);
	}
	document.body.appendChild(article);
});

afterEach(() => {
	jest.useRealTimers();
	document.body.innerHTML = "";
	window.history.replaceState(null, "", "/");
});

it("highlights and scrolls to a verse even when pushState did not set :target", () => {
	render(<ScrollToPasuk perekId={197} />);
	act(() => jest.runOnlyPendingTimers());
	const verse = document.getElementById("pasuk-23");
	expect(verse).toHaveAttribute("aria-current", "location");
	expect(verse).toHaveAttribute("data-pasuk-highlight");
	expect(verse?.scrollIntoView).toHaveBeenCalledWith({
		behavior: "instant",
		block: "start",
	});
});

it("moves the highlight after Next.js hash-only navigation", () => {
	const { rerender } = render(<ScrollToPasuk perekId={197} />);
	window.history.pushState(null, "", "/929/197#pasuk-3");
	mockSearchParams = new URLSearchParams();
	rerender(<ScrollToPasuk perekId={197} />);
	expect(document.getElementById("pasuk-23")).not.toHaveAttribute(
		"data-pasuk-highlight",
	);
	expect(document.getElementById("pasuk-3")).toHaveAttribute(
		"data-pasuk-highlight",
	);
});

it.each(["hashchange", "popstate"])("updates for native %s events", (event) => {
	render(<ScrollToPasuk perekId={197} />);
	window.history.replaceState(null, "", "/929/197#pasuk-3");
	act(() => window.dispatchEvent(new Event(event)));
	expect(document.querySelectorAll("[data-pasuk-highlight]")).toHaveLength(1);
	expect(document.getElementById("pasuk-3")).toHaveAttribute(
		"aria-current",
		"location",
	);
});

it.each(["", "#pasuk-0", "#pasuk-999", "#pasuk-3abc", "#other"])(
	"clears the highlight for %s",
	(hash) => {
		render(<ScrollToPasuk perekId={197} />);
		window.history.replaceState(null, "", `/929/197${hash}`);
		act(() => window.dispatchEvent(new Event("hashchange")));
		expect(document.querySelector("[data-pasuk-highlight]")).toBeNull();
		expect(document.querySelector("[aria-current]")).toBeNull();
	},
);

it("cancels pending scrolling and removes listeners on unmount", () => {
	const verse = document.getElementById("pasuk-23");
	const { unmount } = render(<ScrollToPasuk perekId={197} />);
	unmount();
	act(() => jest.runOnlyPendingTimers());
	expect(verse?.scrollIntoView).not.toHaveBeenCalled();
	window.history.replaceState(null, "", "/929/197#pasuk-3");
	act(() => window.dispatchEvent(new Event("hashchange")));
	expect(document.getElementById("pasuk-3")).not.toHaveAttribute(
		"data-pasuk-highlight",
	);
});

it("does nothing if no scripture article is mounted", () => {
	document.body.innerHTML = "";
	render(<ScrollToPasuk perekId={197} />);
	expect(jest.getTimerCount()).toBe(0);
});
