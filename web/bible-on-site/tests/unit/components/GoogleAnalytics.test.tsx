/**
 * @jest-environment jsdom
 */
import { render, waitFor } from "@testing-library/react";

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

import { isProduction } from "@/util/environment";
import { GoogleAnalytics } from "../../../src/app/components/GoogleAnalytics";
import { GA_GATE_SCRIPT } from "../../../src/app/components/google-analytics-gate";

const mockIsProduction = isProduction as jest.MockedFunction<
	typeof isProduction
>;

// Mirrors the UA-sniff alternation embedded in the rendered GoogleAnalytics script.
const BOT_UA_PATTERN =
	/bot|crawl|spider|slurp|Bytespider|GPTBot|ClaudeBot|CCBot|Amazonbot|Diffbot|PetalBot|AhrefsBot|SemrushBot|DotBot|MJ12bot|BLEXBot|YandexBot|Sogou|Applebot|Googlebot|bingbot|PerplexityBot|FacebookBot|anthropic|TikTokSpider|Baiduspider|MegaIndex/i;

describe("GoogleAnalytics", () => {
	beforeEach(() => {
		mockIsProduction.mockReturnValue(true);
	});

	describe("when in production", () => {
		describe("when measurement is enabled", () => {
			it("renders only the inline gate script", () => {
				const { container } = render(<GoogleAnalytics />);
				const scripts = container.querySelectorAll("[data-script]");
				expect(scripts).toHaveLength(1);
				expect(scripts[0]).toHaveAttribute("data-testid", "google-analytics");
			});

			it("does not eagerly request the gtag library", () => {
				const { getByTestId } = render(<GoogleAnalytics />);
				const script = getByTestId("google-analytics").textContent ?? "";
				// The ~90 KiB library must be injected after the human-traffic
				// decision, not as a sibling <Script src> (#2736).
				expect(script).not.toContain("strategy=");
				const initIndex = script.indexOf("function initGA");
				const gtagSrcIndex = script.indexOf("googletagmanager.com/gtag/js");
				const botdImportIndex = script.indexOf("import(");
				expect(gtagSrcIndex).toBeGreaterThan(initIndex);
				expect(gtagSrcIndex).toBeLessThan(
					script.indexOf("import(", initIndex),
				);
				expect(script.indexOf("el.src")).toBeGreaterThan(initIndex);
				expect(script.indexOf("el.src")).toBeLessThan(botdImportIndex);
				expect(script).toContain("document.head.appendChild(el)");
				// initGA is only invoked from the BotD resolution handlers.
				expect(script.lastIndexOf("initGA()")).toBeGreaterThan(
					botdImportIndex,
				);
			});

			it("includes the GA measurement ID in the script", () => {
				const { getByTestId } = render(<GoogleAnalytics />);
				const gaScript = getByTestId("google-analytics");
				expect(gaScript.textContent).toContain("G-2CHER7MM85");
			});

			it("disables advertising and Google signals before the first measurement config", () => {
				const { getByTestId } = render(<GoogleAnalytics />);
				const script = getByTestId("google-analytics").textContent ?? "";
				expect(script).toContain("allow_google_signals: false");
				expect(script).toContain("allow_ad_personalization_signals: false");
				expect(script).toContain("ad_storage: 'denied'");
				expect(script).toContain("ad_user_data: 'denied'");
				expect(script).toContain("ad_personalization: 'denied'");
				expect(script.indexOf("gtag('consent', 'default'")).toBeLessThan(
					script.indexOf("gtag('config'"),
				);
				expect(script).toContain("Botd.load({ monitoring: false })");
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

			describe("gate script behavior (#2736)", () => {
				const runGate = () => new Function(GA_GATE_SCRIPT)();
				const gtagElements = () =>
					document.querySelectorAll('script[src*="googletagmanager.com/gtag"]');
				const dataLayerCalls = () =>
					(
						(window as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []
					).map((entry) => Array.from(entry));

				afterEach(() => {
					for (const el of gtagElements()) el.remove();
					delete (window as { dataLayer?: unknown[] }).dataLayer;
				});

				it("leaves gtag unloaded while the bot decision is pending", () => {
					// The CDN import only resolves asynchronously, so immediately after
					// the gate ran no measurement request can have been scheduled.
					runGate();
					expect(gtagElements()).toHaveLength(0);
					expect(
						(window as { dataLayer?: unknown[] }).dataLayer,
					).toBeUndefined();
				});

				it("injects the deferred gtag script when the decision fails open", async () => {
					// jsdom cannot import the https BotD module, so the gate's .catch
					// branch runs — the documented fail-open fallback.
					runGate();
					await waitFor(() => expect(gtagElements()).toHaveLength(1));
					const el = gtagElements()[0] as HTMLScriptElement;
					expect(el.async).toBe(true);
					expect(el.src).toBe(
						"https://www.googletagmanager.com/gtag/js?id=G-2CHER7MM85",
					);
				});

				it("queues js, denied consent defaults and config in order", async () => {
					runGate();
					await waitFor(() => expect(dataLayerCalls()).toHaveLength(3));
					const calls = dataLayerCalls();
					expect(calls[0]?.[0]).toBe("js");
					expect(calls[1]?.slice(0, 2)).toEqual(["consent", "default"]);
					expect(calls[1]?.[2]).toEqual({
						ad_storage: "denied",
						ad_user_data: "denied",
						ad_personalization: "denied",
					});
					expect(calls[2]?.slice(0, 2)).toEqual(["config", "G-2CHER7MM85"]);
					expect(calls[2]?.[2]).toEqual({
						allow_google_signals: false,
						allow_ad_personalization_signals: false,
					});
				});

				describe("with a bot user agent", () => {
					const originalUA = window.navigator.userAgent;
					beforeEach(() => {
						Object.defineProperty(window.navigator, "userAgent", {
							value:
								"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
							configurable: true,
						});
					});
					afterEach(() => {
						Object.defineProperty(window.navigator, "userAgent", {
							value: originalUA,
							configurable: true,
						});
					});

					it("returns before scheduling BotD or gtag", async () => {
						// Flush several macrotasks: had the gate reached the CDN import,
						// jsdom's failed import would have run the fail-open initGA by
						// now — so a still-empty head proves the early return held.
						runGate();
						for (let i = 0; i < 5; i++) {
							await new Promise((resolve) => setTimeout(resolve, 0));
						}
						expect(gtagElements()).toHaveLength(0);
						expect(
							(window as { dataLayer?: unknown[] }).dataLayer,
						).toBeUndefined();
					});
				});
			});
		});
	});

	describe("when not in production", () => {
		beforeEach(() => {
			mockIsProduction.mockReturnValue(false);
		});

		it("renders nothing outside production", () => {
			const { container } = render(<GoogleAnalytics />);
			expect(container).toBeEmptyDOMElement();
		});
	});
});
