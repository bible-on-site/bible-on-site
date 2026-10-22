/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";

jest.mock("next/script", () => {
	return function MockScript({
		children,
		id,
	}: {
		children?: string;
		id?: string;
	}) {
		return (
			<pre data-testid={id} data-script>
				{children}
			</pre>
		);
	};
});

jest.mock("@/util/environment", () => ({
	isProduction: jest.fn(),
}));

import {
	ANALYTICS_CONSENT_KEY,
	setAnalyticsConsent,
} from "@/lib/analytics-consent";
import { isProduction } from "@/util/environment";
import { GoogleAnalytics } from "../../../src/app/components/GoogleAnalytics";

const mockIsProduction = isProduction as jest.MockedFunction<
	typeof isProduction
>;

// Mirrors the UA-sniff alternation embedded in the rendered GoogleAnalytics script.
const BOT_UA_PATTERN =
	/bot|crawl|spider|slurp|Bytespider|GPTBot|ClaudeBot|CCBot|Amazonbot|Diffbot|PetalBot|AhrefsBot|SemrushBot|DotBot|MJ12bot|BLEXBot|YandexBot|Sogou|Applebot|Googlebot|bingbot|PerplexityBot|FacebookBot|anthropic|TikTokSpider|Baiduspider|MegaIndex/i;

const GA_DISABLE_FLAG = "ga-disable-G-2CHER7MM85";

describe("GoogleAnalytics", () => {
	beforeEach(() => {
		localStorage.clear();
		delete (window as unknown as Record<string, boolean>)[GA_DISABLE_FLAG];
		mockIsProduction.mockReturnValue(true);
	});

	describe("when in production", () => {
		describe("consent gating (#2400)", () => {
			it("renders nothing before the user decides", () => {
				const { container } = render(<GoogleAnalytics />);
				expect(container.querySelectorAll("[data-script]")).toHaveLength(0);
			});

			it("renders nothing after the user denies analytics", () => {
				localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
				const { container } = render(<GoogleAnalytics />);
				expect(container.querySelectorAll("[data-script]")).toHaveLength(0);
			});

			it("mounts the scripts once consent is granted mid-session", () => {
				const { container } = render(<GoogleAnalytics />);
				expect(container.querySelectorAll("[data-script]")).toHaveLength(0);
				act(() => setAnalyticsConsent("granted"));
				expect(
					container.querySelectorAll("[data-script]").length,
				).toBeGreaterThan(0);
			});

			it("sets the ga-disable opt-out flag on mid-session denial", () => {
				const win = window as unknown as Record<string, boolean>;
				render(<GoogleAnalytics />);
				act(() => setAnalyticsConsent("granted"));
				expect(win[GA_DISABLE_FLAG]).toBe(false);
				act(() => setAnalyticsConsent("denied"));
				expect(win[GA_DISABLE_FLAG]).toBe(true);
			});
		});

		describe("when analytics consent is granted", () => {
			beforeEach(() => {
				localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
			});

			it("renders Google Analytics scripts for regular traffic", () => {
				const { container } = render(<GoogleAnalytics />);
				const scripts = container.querySelectorAll("[data-script]");
				expect(scripts.length).toBeGreaterThan(0);
			});

			it("includes the GA measurement ID in the script", () => {
				const { getByTestId } = render(<GoogleAnalytics />);
				const gaScript = getByTestId("google-analytics");
				expect(gaScript.textContent).toContain("G-2CHER7MM85");
			});

			describe("client-side bot detection", () => {
				it("includes navigator.userAgent check before BotD detection", () => {
					const { getByTestId } = render(<GoogleAnalytics />);
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
					const { getByTestId } = render(<GoogleAnalytics />);
					const script = getByTestId("google-analytics").textContent ?? "";
					const regexMatch = script.match(/\/([^/]+)\/i\.test/);
					if (!regexMatch?.[1]) throw new Error("Bot regex not found");
					expect(regexMatch[1]).toBe(BOT_UA_PATTERN.source);
					expect(BOT_UA_PATTERN.test(botName)).toBe(true);
				});

				it("bot regex does not match regular browser UAs", () => {
					const { getByTestId } = render(<GoogleAnalytics />);
					const script = getByTestId("google-analytics").textContent ?? "";
					const regexMatch = script.match(/\/([^/]+)\/i\.test/);
					if (!regexMatch?.[1]) throw new Error("Bot regex not found");
					expect(regexMatch[1]).toBe(BOT_UA_PATTERN.source);
					expect(
						BOT_UA_PATTERN.test(
							"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
						),
					).toBe(false);
				});
			});

			describe("BotD headless browser detection", () => {
				it("loads BotD from CDN before initializing GA", () => {
					const { getByTestId } = render(<GoogleAnalytics />);
					const script = getByTestId("google-analytics").textContent ?? "";
					expect(script).toContain("openfpcdn.io/botd/v2");
				});

				it("only calls initGA when BotD reports not a bot", () => {
					const { getByTestId } = render(<GoogleAnalytics />);
					const script = getByTestId("google-analytics").textContent ?? "";
					expect(script).toContain("!result.bot");
					expect(script).toContain("initGA()");
				});

				it("falls back to initializing GA if BotD fails", () => {
					const { getByTestId } = render(<GoogleAnalytics />);
					const script = getByTestId("google-analytics").textContent ?? "";
					expect(script).toContain(".catch(");
					const catchIndex = script.indexOf(".catch(");
					const catchBlock = script.slice(catchIndex, catchIndex + 60);
					expect(catchBlock).toContain("initGA");
				});
			});
		});
	});

	describe("when not in production", () => {
		beforeEach(() => {
			mockIsProduction.mockReturnValue(false);
			localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
		});

		it("renders nothing even with consent", () => {
			const { container } = render(<GoogleAnalytics />);
			expect(container).toBeEmptyDOMElement();
		});
	});
});
