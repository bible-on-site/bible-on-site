/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";

// Mock next/script to avoid SSR issues in tests
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

// Mock the environment module
jest.mock("@/util/environment", () => ({
	isProduction: jest.fn(),
}));

import { isProduction } from "@/util/environment";
import { GoogleAnalytics } from "../../../src/app/components/GoogleAnalytics";

const mockIsProduction = isProduction as jest.MockedFunction<
	typeof isProduction
>;

describe("GoogleAnalytics", () => {
	afterEach(() => {
		jest.clearAllMocks();
	});

	describe("when in production", () => {
		beforeEach(() => {
			mockIsProduction.mockReturnValue(true);
		});

		it("renders Google Analytics scripts", () => {
			const { container } = render(<GoogleAnalytics />);
			const scripts = container.querySelectorAll("script");
			expect(scripts.length).toBeGreaterThan(0);
		});

		it("includes the GA measurement ID in the script", () => {
			const { getByTestId } = render(<GoogleAnalytics />);
			const gaScript = getByTestId("google-analytics");
			expect(gaScript.textContent).toContain("G-2CHER7MM85");
		});

		describe("bot detection guard", () => {
			function getInlineScript() {
				const { getByTestId } = render(<GoogleAnalytics />);
				return getByTestId("google-analytics").textContent ?? "";
			}

			it("contains a user-agent check that runs before gtag config", () => {
				const script = getInlineScript();
				const uaCheckIndex = script.indexOf("navigator.userAgent");
				const gtagConfigIndex = script.indexOf("gtag('config'");
				expect(uaCheckIndex).toBeGreaterThan(-1);
				expect(gtagConfigIndex).toBeGreaterThan(-1);
				expect(uaCheckIndex).toBeLessThan(gtagConfigIndex);
			});

			it.each([
				"Googlebot",
				"bingbot",
				"GPTBot",
				"ClaudeBot",
				"Bytespider",
				"AhrefsBot",
				"SemrushBot",
				"PetalBot",
				"anthropic",
				"Amazonbot",
				"FacebookBot",
				"PerplexityBot",
				"YandexBot",
				"CCBot",
			])("matches bot user-agent pattern: %s", (botName) => {
				const script = getInlineScript();
				const regexMatch = script.match(
					/if\s*\(\/([^/]+)\/[a-z]*\.test\(ua\)\)/,
				);
				expect(regexMatch).not.toBeNull();
				const pattern = new RegExp(regexMatch?.[1] ?? "", "i");
				expect(pattern.test(botName)).toBe(true);
			});

			it("does not match a regular browser user-agent", () => {
				const script = getInlineScript();
				const regexMatch = script.match(
					/if\s*\(\/([^/]+)\/[a-z]*\.test\(ua\)\)/,
				);
				expect(regexMatch).not.toBeNull();
				const pattern = new RegExp(regexMatch?.[1] ?? "", "i");
				expect(
					pattern.test(
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
					),
				).toBe(false);
			});

			it("returns early before configuring gtag when bot is detected", () => {
				const script = getInlineScript();
				const returnIndex = script.indexOf("return;");
				const gtagConfigIndex = script.indexOf("gtag('config'");
				expect(returnIndex).toBeGreaterThan(-1);
				expect(returnIndex).toBeLessThan(gtagConfigIndex);
			});
		});
	});

	describe("when not in production", () => {
		beforeEach(() => {
			mockIsProduction.mockReturnValue(false);
		});

		it("returns null and renders nothing", () => {
			const { container } = render(<GoogleAnalytics />);
			expect(container.firstChild).toBeNull();
		});
	});
});
