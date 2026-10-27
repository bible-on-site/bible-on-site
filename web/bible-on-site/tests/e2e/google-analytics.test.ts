import type { Page } from "@playwright/test";
import { GA_GATE_SCRIPT } from "../../src/app/components/google-analytics-gate";
import { expect, test } from "../util/playwright/test-fixture";

const GA_ENDPOINT = "https://www.googletagmanager.com/gtag/js";
const BOTD_ENDPOINT = "https://openfpcdn.io/botd/v2";

test.describe("Google Analytics", () => {
	test.describe("when NEXT_PUBLIC_ENV is production", () => {
		test.use({
			// We can't set env vars at runtime, so we intercept and check the request
		});

		test("loads GA script in production", async ({ page }) => {
			// Track if GA script was requested
			let gaRequested = false;

			// Mock the GA endpoint - intercept and track the request
			await page.route(`${GA_ENDPOINT}**`, async (route) => {
				gaRequested = true;
				// Return empty script to avoid actual GA loading
				await route.fulfill({
					status: 200,
					contentType: "application/javascript",
					body: "// Mocked GA script",
				});
			});

			// Navigate to the page
			await page.goto("/");

			await page.waitForLoadState("domcontentloaded");

			// In non-production (default test env), GA should NOT be requested
			// since NEXT_PUBLIC_ENV is not set to "production"
			expect(gaRequested).toBe(false);
		});
	});

	test.describe("when NEXT_PUBLIC_ENV is not production", () => {
		test("does not load GA script", async ({ page }) => {
			// Track all network requests to GA
			const gaRequests: string[] = [];

			await page.route(`${GA_ENDPOINT}**`, async (route) => {
				gaRequests.push(route.request().url());
				await route.fulfill({
					status: 200,
					contentType: "application/javascript",
					body: "// Mocked GA script",
				});
			});

			// Navigate to the page
			await page.goto("/");

			await page.waitForLoadState("domcontentloaded");

			// Verify no GA requests were made
			expect(gaRequests).toHaveLength(0);
		});

		test("does not include GA script tags in DOM", async ({ page }) => {
			await page.goto("/");

			// Check that no GA script tags exist in the page
			const gaScripts = await page.locator(
				`script[src*="googletagmanager.com/gtag"]`
			);
			await expect(gaScripts).toHaveCount(0);

			// Also check for inline gtag script
			const inlineGaScript = await page.locator('script[id="google-analytics"]');
			await expect(inlineGaScript).toHaveCount(0);
		});
	});

	// Deferred loading (#2736): run the exact production gate script on the
	// served page, with the analytics endpoints intercepted so automated runs
	// emit no synthetic production traffic.
	test.describe("deferred gtag loading", () => {
		const runGate = (page: Page) =>
			page.addScriptTag({ content: GA_GATE_SCRIPT });
		const dataLayerCalls = (page: Page) =>
			page.evaluate(() =>
				(
					(window as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []
				).map((entry) => Array.from(entry)),
			);

		async function stubBotd(
			page: Page,
			outcome: { bot: boolean } | "load-failure" | "undecided",
		) {
			const body =
				outcome === "undecided"
					? "export function load() { return new Promise(() => {}); }"
					: outcome === "load-failure"
						? "export function load() { return Promise.reject(new Error('blocked')); }"
						: `export function load() { return Promise.resolve({ detect: () => Promise.resolve({ bot: ${outcome.bot} }).then(function(r) { window.__botdDetected = r; return r; }) }); }`;
			await page.route(`${BOTD_ENDPOINT}**`, async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/javascript",
					headers: { "access-control-allow-origin": "*" },
					body,
				});
			});
		}

		async function trackGtag(page: Page) {
			const gtagRequests: string[] = [];
			await page.route(`${GA_ENDPOINT}**`, async (route) => {
				gtagRequests.push(route.request().url());
				await route.fulfill({
					status: 200,
					contentType: "application/javascript",
					body: "// Mocked GA script",
				});
			});
			return gtagRequests;
		}

		test("requests gtag only after the human decision resolves", async ({
			page,
		}) => {
			const requestOrder: string[] = [];
			await page.route(`${BOTD_ENDPOINT}**`, async (route) => {
				requestOrder.push("botd");
				await route.fulfill({
					status: 200,
					contentType: "application/javascript",
					headers: { "access-control-allow-origin": "*" },
					body: "export function load() { return Promise.resolve({ detect: () => Promise.resolve({ bot: false }) }); }",
				});
			});
			const gtagRequests: string[] = [];
			await page.route(`${GA_ENDPOINT}**`, async (route) => {
				requestOrder.push("gtag");
				gtagRequests.push(route.request().url());
				await route.fulfill({
					status: 200,
					contentType: "application/javascript",
					body: "// Mocked GA script",
				});
			});
			await page.goto("/");

			const gtagRequest = page.waitForRequest(`${GA_ENDPOINT}**`);
			await runGate(page);
			await gtagRequest;
			await expect.poll(() => gtagRequests.length).toBe(1);

			expect(requestOrder).toEqual(["botd", "gtag"]);
			await expect(
				page.locator('script[src*="googletagmanager.com/gtag"]'),
			).toHaveCount(1);

			const calls = await dataLayerCalls(page);
			expect(calls.map((call) => call[0])).toEqual([
				"js",
				"consent",
				"config",
			]);
			expect(calls[1]?.[1]).toBe("default");
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

		test("never requests gtag while the bot decision is pending", async ({
			page,
		}) => {
			const gtagRequests = await trackGtag(page);
			await stubBotd(page, "undecided");
			await page.goto("/");

			const botdRequest = page.waitForRequest(`${BOTD_ENDPOINT}**`);
			const premature = page
				.waitForRequest(`${GA_ENDPOINT}**`, { timeout: 2000 })
				.catch(() => null);
			await runGate(page);
			await botdRequest;

			expect(await premature).toBeNull();
			expect(gtagRequests).toHaveLength(0);
			await expect(
				page.locator('script[src*="googletagmanager.com/gtag"]'),
			).toHaveCount(0);
		});

		test("never requests gtag when BotD reports a bot", async ({ page }) => {
			const gtagRequests = await trackGtag(page);
			await stubBotd(page, { bot: true });
			await page.goto("/");

			const botdRequest = page.waitForRequest(`${BOTD_ENDPOINT}**`);
			await runGate(page);
			await botdRequest;
			// Wait for the stub's marker so the negative gtag window only starts
			// after the bot decision has actually landed on the page.
			await page.waitForFunction(
				() =>
					(window as { __botdDetected?: unknown }).__botdDetected !==
					undefined,
			);
			const late = await page
				.waitForRequest(`${GA_ENDPOINT}**`, { timeout: 2000 })
				.catch(() => null);

			expect(late).toBeNull();
			expect(gtagRequests).toHaveLength(0);
			await expect(
				page.locator('script[src*="googletagmanager.com/gtag"]'),
			).toHaveCount(0);
			expect(await dataLayerCalls(page)).toHaveLength(0);
		});

		test("falls back to loading gtag when BotD cannot load", async ({
			page,
		}) => {
			const gtagRequests = await trackGtag(page);
			await stubBotd(page, "load-failure");
			await page.goto("/");

			const gtagRequest = page.waitForRequest(`${GA_ENDPOINT}**`);
			await runGate(page);
			await gtagRequest;
			await expect.poll(() => gtagRequests.length).toBe(1);

			const calls = await dataLayerCalls(page);
			expect(calls.map((call) => call[0])).toEqual([
				"js",
				"consent",
				"config",
			]);
		});

		test("requests neither BotD nor gtag for bot user agents", async ({
			browser,
		}) => {
			const context = await browser.newContext({
				userAgent:
					"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
			});
			const page = await context.newPage();
			const gtagRequests = await trackGtag(page);
			let botdRequested = false;
			await page.route(`${BOTD_ENDPOINT}**`, async (route) => {
				botdRequested = true;
				await route.abort();
			});
			await page.goto("/");

			await runGate(page);
			const unexpected = await page
				.waitForRequest(`${GA_ENDPOINT}**`, { timeout: 2000 })
				.catch(() => null);

			expect(unexpected).toBeNull();
			expect(gtagRequests).toHaveLength(0);
			expect(botdRequested).toBe(false);
			await context.close();
		});

		test("emits a single measurement config per execution", async ({
			page,
		}) => {
			const gtagRequests = await trackGtag(page);
			await stubBotd(page, { bot: false });
			await page.goto("/");

			const gtagRequest = page.waitForRequest(`${GA_ENDPOINT}**`);
			await runGate(page);
			await gtagRequest;
			await expect.poll(() => gtagRequests.length).toBe(1);

			expect(
				(await dataLayerCalls(page)).filter((call) => call[0] === "config"),
			).toHaveLength(1);
		});
	});
});
