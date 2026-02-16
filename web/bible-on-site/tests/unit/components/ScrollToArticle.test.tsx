/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";
import {
	ScrollToArticle,
	ScrollToSlug,
} from "@/app/929/[number]/[slug]/ScrollToArticle";

describe("ScrollToSlug", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
		document.body.innerHTML = "";
	});

	it("scrolls to target element with instant behavior by default", () => {
		const scrollIntoView = jest.fn();
		const div = document.createElement("div");
		div.id = "perush-view";
		div.scrollIntoView = scrollIntoView;
		document.body.appendChild(div);

		render(<ScrollToSlug targetId="perush-view" />);
		jest.advanceTimersByTime(100);

		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "instant",
			block: "start",
		});
	});

	it("scrolls to article-view when targetId is article-view", () => {
		const scrollIntoView = jest.fn();
		const div = document.createElement("div");
		div.id = "article-view";
		div.scrollIntoView = scrollIntoView;
		document.body.appendChild(div);

		render(<ScrollToSlug targetId="article-view" />);
		jest.advanceTimersByTime(100);

		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "instant",
			block: "start",
		});
	});

	it("supports custom scroll behavior", () => {
		const scrollIntoView = jest.fn();
		const div = document.createElement("div");
		div.id = "test-target";
		div.scrollIntoView = scrollIntoView;
		document.body.appendChild(div);

		render(<ScrollToSlug targetId="test-target" behavior="smooth" />);
		jest.advanceTimersByTime(100);

		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "smooth",
			block: "start",
		});
	});

	it("does nothing when target element does not exist", () => {
		render(<ScrollToSlug targetId="nonexistent" />);
		jest.advanceTimersByTime(100);

		expect(document.getElementById("nonexistent")).toBeNull();
	});
});

describe("ScrollToArticle (backward-compat)", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
		document.body.innerHTML = "";
	});

	it("scrolls to article-view element with instant behavior", () => {
		const scrollIntoView = jest.fn();
		const div = document.createElement("div");
		div.id = "article-view";
		div.scrollIntoView = scrollIntoView;
		document.body.appendChild(div);

		render(<ScrollToArticle />);
		jest.advanceTimersByTime(100);

		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "instant",
			block: "start",
		});
	});
});
