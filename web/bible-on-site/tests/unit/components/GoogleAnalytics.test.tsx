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

import { isProduction } from "@/util/environment";
import { GoogleAnalytics } from "../../../src/app/components/GoogleAnalytics";

const mockIsProduction = isProduction as jest.MockedFunction<
	typeof isProduction
>;

function renderResult(result: ReturnType<typeof GoogleAnalytics>) {
	return render(result as React.ReactElement);
}

describe("GoogleAnalytics", () => {
	afterEach(() => {
		jest.clearAllMocks();
	});

	describe("when in production", () => {
		beforeEach(() => {
			mockIsProduction.mockReturnValue(true);
		});

		it("renders Google Analytics scripts for regular traffic", () => {
			const result = GoogleAnalytics();
			const { container } = renderResult(result);
			const scripts = container.querySelectorAll("script");
			expect(scripts.length).toBeGreaterThan(0);
		});

		it("includes the GA measurement ID in the script", () => {
			const result = GoogleAnalytics();
			const { getByTestId } = renderResult(result);
			const gaScript = getByTestId("google-analytics");
			expect(gaScript.textContent).toContain("G-2CHER7MM85");
		});

		describe("client-side bot detection", () => {
			it("includes navigator.userAgent check before BotD detection", () => {
				const result = GoogleAnalytics();
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
			])("bot regex matches %s", (botName) => {
				const result = GoogleAnalytics();
				const { getByTestId } = renderResult(result);
				const script = getByTestId("google-analytics").textContent ?? "";
				const regexMatch = script.match(/\/([^/]+)\/i\.test/);
				expect(regexMatch).toBeTruthy();
				const regex = new RegExp(regexMatch?.[1], "i");
				expect(regex.test(botName)).toBe(true);
			});

			it("bot regex does not match regular browser UAs", () => {
				const result = GoogleAnalytics();
				const { getByTestId } = renderResult(result);
				const script = getByTestId("google-analytics").textContent ?? "";
				const regexMatch = script.match(/\/([^/]+)\/i\.test/);
				const regex = new RegExp(regexMatch?.[1], "i");
				expect(
					regex.test(
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
					),
				).toBe(false);
			});
		});

		describe("BotD headless browser detection", () => {
			it("loads BotD from CDN before initializing GA", () => {
				const result = GoogleAnalytics();
				const { getByTestId } = renderResult(result);
				const script = getByTestId("google-analytics").textContent ?? "";
				expect(script).toContain("openfpcdn.io/botd/v2");
			});

			it("only calls initGA when BotD reports not a bot", () => {
				const result = GoogleAnalytics();
				const { getByTestId } = renderResult(result);
				const script = getByTestId("google-analytics").textContent ?? "";
				expect(script).toContain("!result.bot");
				expect(script).toContain("initGA()");
			});

			it("falls back to initializing GA if BotD fails", () => {
				const result = GoogleAnalytics();
				const { getByTestId } = renderResult(result);
				const script = getByTestId("google-analytics").textContent ?? "";
				expect(script).toContain(".catch(");
				const catchIndex = script.indexOf(".catch(");
				const catchBlock = script.slice(catchIndex, catchIndex + 60);
				expect(catchBlock).toContain("initGA");
			});
		});
	});

	describe("when not in production", () => {
		beforeEach(() => {
			mockIsProduction.mockReturnValue(false);
		});

		it("returns null and renders nothing", () => {
			const result = GoogleAnalytics();
			expect(result).toBeNull();
		});
	});
});
