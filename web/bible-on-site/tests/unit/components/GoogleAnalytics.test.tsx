/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";

jest.mock("next/script", () => {
	return function MockScript({
		children,
		id,
	}: {
		children?: string;
		id?: string;
	}) {
		return <script data-testid={id}>{children}</script>;
	};
});

jest.mock("@/util/environment", () => ({
	isProduction: jest.fn(),
}));

let mockHeaders: Map<string, string>;
jest.mock("next/headers", () => ({
	headers: jest.fn(async () => mockHeaders),
}));

import { isProduction } from "@/util/environment";
import { GoogleAnalytics } from "../../../src/app/components/GoogleAnalytics";

const mockIsProduction = isProduction as jest.MockedFunction<
	typeof isProduction
>;

function renderResult(result: Awaited<ReturnType<typeof GoogleAnalytics>>) {
	return render(result as React.ReactElement);
}

describe("GoogleAnalytics", () => {
	beforeEach(() => {
		mockHeaders = new Map<string, string>();
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe("when in production", () => {
		beforeEach(() => {
			mockIsProduction.mockReturnValue(true);
		});

		it("renders Google Analytics scripts for regular traffic", async () => {
			const result = await GoogleAnalytics();
			const { container } = renderResult(result);
			const scripts = container.querySelectorAll("script");
			expect(scripts.length).toBeGreaterThan(0);
		});

		it("includes the GA measurement ID in the script", async () => {
			const result = await GoogleAnalytics();
			const { getByTestId } = renderResult(result);
			const gaScript = getByTestId("google-analytics");
			expect(gaScript.textContent).toContain("G-2CHER7MM85");
		});

		it("returns null when x-bot-class header is 'crawler'", async () => {
			mockHeaders.set("x-bot-class", "crawler");
			const result = await GoogleAnalytics();
			expect(result).toBeNull();
		});

		it("returns null when x-bot-class header is 'blocked'", async () => {
			mockHeaders.set("x-bot-class", "blocked");
			const result = await GoogleAnalytics();
			expect(result).toBeNull();
		});

		it("renders scripts when x-bot-class header is absent", async () => {
			const result = await GoogleAnalytics();
			const { container } = renderResult(result);
			expect(container.querySelectorAll("script").length).toBeGreaterThan(0);
		});

		describe("client-side bot detection", () => {
			it("includes navigator.userAgent check before gtag config", async () => {
				const result = await GoogleAnalytics();
				const { getByTestId } = renderResult(result);
				const script = getByTestId("google-analytics").textContent ?? "";
				expect(script).toContain("navigator.userAgent");
				const uaCheckIndex = script.indexOf("navigator.userAgent");
				const gtagConfigIndex = script.indexOf("gtag('config'");
				expect(uaCheckIndex).toBeLessThan(gtagConfigIndex);
			});

			it.each([
				"GPTBot",
				"ClaudeBot",
				"PerplexityBot",
				"Googlebot",
				"bingbot",
				"Bytespider",
				"AhrefsBot",
				"SemrushBot",
				"Baiduspider",
				"TikTokSpider",
				"MegaIndex",
			])("bot regex matches %s", async (botName) => {
				const result = await GoogleAnalytics();
				const { getByTestId } = renderResult(result);
				const script = getByTestId("google-analytics").textContent ?? "";
				const regexMatch = script.match(/\/([^/]+)\/i\.test/);
				expect(regexMatch).toBeTruthy();
				const regex = new RegExp(regexMatch![1], "i");
				expect(regex.test(botName)).toBe(true);
			});

			it("bot regex does not match regular browser UAs", async () => {
				const result = await GoogleAnalytics();
				const { getByTestId } = renderResult(result);
				const script = getByTestId("google-analytics").textContent ?? "";
				const regexMatch = script.match(/\/([^/]+)\/i\.test/);
				const regex = new RegExp(regexMatch![1], "i");
				expect(
					regex.test(
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
					),
				).toBe(false);
			});
		});
	});

	describe("when not in production", () => {
		beforeEach(() => {
			mockIsProduction.mockReturnValue(false);
		});

		it("returns null and renders nothing", async () => {
			const result = await GoogleAnalytics();
			expect(result).toBeNull();
		});
	});
});
