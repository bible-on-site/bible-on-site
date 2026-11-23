import { randomBytes } from "node:crypto";
import type { Page, Worker } from "@playwright/test";
import { dailyPerekPayload } from "../../src/lib/web-push/payload";
import { expect, test } from "../util/playwright/test-fixture";

/**
 * Real-browser coverage of the daily perek push opt-in (#1096) and the
 * no-install product decision (#2936).
 *
 * The server side runs for real against the e2e deployment: VAPID keys and a
 * send secret are injected into the web server env by playwright.e2e.config,
 * the toggle fetches the real `GET /api/push/subscription`, and POST/DELETE
 * persist through the real route into the test database. The real
 * `public/sw.js` worker is registered and its push/notificationclick handlers
 * are dispatched and observed inside the live worker.
 *
 * Headless test browsers stub only the platform boundaries they genuinely
 * lack — there is no OS notification surface and no push-service transport in
 * an automation build, so `Notification.requestPermission`,
 * `PushManager.subscribe/getSubscription/unsubscribe` and
 * `registration.showNotification` are replaced at the boundary while
 * everything owned by this repository stays real.
 */

interface PushStubArgs {
	// Notification.permission as the page sees it on load.
	permission: "granted" | "denied" | "default";
	// The answer Notification.requestPermission resolves with; defaults to
	// `permission`. A "default"-permission browser can still grant the
	// prompt, which is the flow #3732 gates behind the section's own click.
	permissionAnswer?: "granted" | "denied" | "default";
	endpoint: string;
	p256dh: string;
	auth: string;
	// iOS Safari ordinary tabs do not expose the push APIs to web pages at
	// all; hiding PushManager reproduces that capability surface.
	hidePushApis?: boolean;
}

function installPushStub() {
	return ({
		permission,
		permissionAnswer,
		endpoint,
		p256dh,
		auth,
		hidePushApis,
	}: PushStubArgs) => {
		if (hidePushApis) {
			const globals = window as unknown as Record<string, unknown>;
			delete globals.PushManager;
			delete globals.Notification;
			return;
		}

		const decode = (value: string) =>
			Uint8Array.from(
				atob(value.replace(/-/g, "+").replace(/_/g, "/")),
				(char) => char.charCodeAt(0),
			);

		// A real PushManager subscription survives page navigations; mirror
		// that with a localStorage flag so the dropdown/card sync assertions
		// run against the same lifecycle the browser gives the site.
		const STORAGE_FLAG = "__e2ePushSubscribed";
		let subscription: {
			endpoint: string;
			expirationTime: null;
			getKey: (name: string) => ArrayBuffer;
			toJSON: () => {
				endpoint: string;
				keys: { p256dh: string; auth: string };
			};
			unsubscribe: () => Promise<boolean>;
		} | null = null;
		const makeSubscription = () => ({
			endpoint,
			expirationTime: null,
			getKey: (name: string) =>
				decode(name === "p256dh" ? p256dh : auth).buffer,
			toJSON: () => ({ endpoint, keys: { p256dh, auth } }),
			unsubscribe: async () => {
				localStorage.removeItem(STORAGE_FLAG);
				subscription = null;
				return true;
			},
		});
		if (localStorage.getItem(STORAGE_FLAG)) {
			subscription = makeSubscription();
		}

		const pushManager = PushManager.prototype as unknown as Record<
			string,
			unknown
		>;
		pushManager.subscribe = async () => {
			localStorage.setItem(STORAGE_FLAG, "1");
			subscription = makeSubscription();
			return subscription;
		};
		pushManager.getSubscription = async () => subscription;

		Object.defineProperty(window, "Notification", {
			configurable: true,
			value: {
				get permission() {
					return permission;
				},
				requestPermission() {
					// #3732: the prompt may only come from the section's own enable
					// click — every test counts these calls.
					const w = window as unknown as { __permissionCalls?: number };
					w.__permissionCalls = (w.__permissionCalls ?? 0) + 1;
					return Promise.resolve(permissionAnswer ?? permission);
				},
			},
		});
	};
}

const permissionCalls = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { __permissionCalls?: number })
				.__permissionCalls ?? 0,
	);

interface ShownNotification {
	title: string;
	options: NotificationOptions & { data?: { url?: string } };
}

/**
 * The service-worker global the spec evaluates into. `ServiceWorkerGlobalScope`
 * lives in lib.webworker which this tsconfig does not include, so the spec
 * declares only the members it touches.
 */
interface PushWorkerScope {
	registration: {
		showNotification: (
			title: string,
			options: NotificationOptions,
		) => Promise<void>;
	};
	clients: Record<string, unknown>;
	dispatchEvent: (event: Event) => boolean;
	__shown?: ShownNotification[];
	__clicks?: { action: "focus" | "openWindow"; url: string }[];
}

/**
 * Dispatches a synthetic push event into the real worker and captures the
 * notifications its handler asks the platform to show.
 */
async function dispatchPush(worker: Worker, payload: unknown) {
	return (await worker.evaluate(async (data) => {
		const scope = self as unknown as PushWorkerScope;
		if (!scope.__shown) {
			scope.__shown = [];
			scope.registration.showNotification = (
				title: string,
				options: NotificationOptions,
			) => {
				scope.__shown?.push({ title, options });
				return Promise.resolve();
			};
		}
		const pending: Promise<unknown>[] = [];
		const event = new Event("push");
		Object.assign(event, {
			data: { json: () => data },
			waitUntil: (promise: Promise<unknown>) => pending.push(promise),
		});
		scope.dispatchEvent(event);
		await Promise.all(pending);
		return scope.__shown;
	}, payload)) as ShownNotification[];
}

/**
 * Dispatches a synthetic notificationclick into the real worker and returns
 * which client it chose. `matchAll` and the same-origin URL logic run for
 * real; only the platform window calls are captured — focusing or opening a
 * window is gated on a real OS notification interaction that a synthetic
 * event cannot provide (both reject with InvalidAccessError in every test
 * browser, headed or not).
 */
async function dispatchNotificationClick(worker: Worker, url: string) {
	return (await worker.evaluate(async (clickUrl) => {
		const scope = self as unknown as PushWorkerScope;
		if (!scope.__clicks) {
			scope.__clicks = [];
			const clients = scope.clients as {
				openWindow: (url: string) => Promise<unknown>;
			};
			clients.openWindow = async (openUrl: string) => {
				scope.__clicks?.push({ action: "openWindow", url: openUrl });
				return { url: openUrl, focused: false };
			};
			const focusable = (
				(self as unknown as Record<string, unknown>)
					.WindowClient as { prototype: Record<string, unknown> }
			).prototype;
			focusable.focus = async function focus(this: { url: string }) {
				scope.__clicks?.push({ action: "focus", url: this.url });
				return this;
			};
		}
		const pending: Promise<unknown>[] = [];
		const event = new Event("notificationclick");
		Object.assign(event, {
			notification: { data: { url: clickUrl }, close: () => {} },
			waitUntil: (promise: Promise<unknown>) => pending.push(promise),
		});
		scope.dispatchEvent(event);
		const settled = await Promise.allSettled(pending);
		return {
			clicks: scope.__clicks,
			errors: settled
				.filter((entry) => entry.status === "rejected")
				.map((entry) => String((entry as PromiseRejectedResult).reason)),
		};
	}, url)) as {
		clicks: { action: "focus" | "openWindow"; url: string }[];
		errors: string[];
	};
}

function fakeSubscription() {
	return {
		endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${randomBytes(9).toString("hex")}`,
		p256dh: randomBytes(65).toString("base64url"),
		auth: randomBytes(16).toString("base64url"),
	};
}

// The dedicated reminder card inside the bulletin section (#3732) — the
// only place a click may reach Notification.requestPermission().
const pushSection = (page: Page) => page.locator("#bulletin-push");

test.describe("daily perek push notifications (#1096)", () => {
	test.beforeEach(async ({ request }) => {
		// `reuseExistingServer` lets an ordinary dev server already listening on
		// the e2e port stand in for the launcher, but such a server never
		// received the VAPID/send-secret env the config injects, so the toggle
		// would stay hidden and every test would time out. Fail fast on the
		// deployment's own configured check instead.
		const response = await request.get("/api/push/subscription");
		const { publicKey } = (await response.json()) as {
			publicKey: string | null;
		};
		expect(
			publicKey,
			"push is unconfigured on the reused server — stop the server already on the e2e port so the launcher injects the test VAPID keys",
		).toBeTruthy();
	});

	test("opt-in registers the worker, stores the subscription, renders pushes and routes clicks to the daily perek", async ({
		page,
		context,
		baseURL,
	}) => {
		const sub = fakeSubscription();
		await context.addInitScript(installPushStub(), {
			permission: "granted" as const,
			...sub,
		});
		const workerRegistered = context.waitForEvent("serviceworker");
		await page.goto("/");

		const section = pushSection(page);
		const enable = section.getByRole("button", { name: "הפעלת התראות" });
		const disable = section.getByRole("button", { name: "ביטול התראות" });
		await expect(enable).toBeVisible();
		await expect(enable).toBeEnabled();
		await expect(disable).toBeDisabled();
		expect(await permissionCalls(page)).toBe(0);

		// Opt in through the real UI: one permission prompt from the section's
		// own click, real worker registration, real POST, real row in the
		// test database.
		const posted = page.waitForResponse(
			(response) =>
				response.url().endsWith("/api/push/subscription") &&
				response.request().method() === "POST",
		);
		await enable.click();
		expect(await permissionCalls(page)).toBe(1);
		const response = await posted;
		expect(response.status()).toBe(201);
		expect(response.request().postDataJSON()).toMatchObject({
			endpoint: sub.endpoint,
			keys: { p256dh: sub.p256dh, auth: sub.auth },
		});
		await expect(disable).toBeEnabled();
		await expect(enable).toBeDisabled();
		await expect(section).toContainText("ההתראה היומית פעילה");

		const worker = await workerRegistered;
		expect(worker.url().endsWith("/sw.js")).toBe(true);

		// The exact payload the daily sender builds reaches the real push
		// handler, so a sender/worker contract drift fails here.
		const origin = new URL(baseURL as string).origin;
		const payload = dailyPerekPayload(1);
		const shown = await dispatchPush(worker, payload);
		expect(shown).toHaveLength(1);
		expect(shown[0].title).toBe(payload.title);
		expect(shown[0].options).toMatchObject({
			body: payload.body,
			icon: "/images/logos/logo192.webp",
			lang: "he",
			dir: "rtl",
			tag: payload.tag,
		});
		expect(shown[0].options.data?.url).toBe(`${origin}${payload.url}`);

		// A foreign URL in a push never navigates off-site.
		const hostile = await dispatchPush(worker, {
			url: "https://evil.example/phish",
		});
		expect(hostile).toHaveLength(2);
		expect(hostile[1].options.data?.url).toBe(origin);

		// Clicking a notification for an already-open page focuses it: the
		// matchAll/find comparison runs for real against the live client list.
		const focusClick = await dispatchNotificationClick(worker, `${origin}/`);
		expect(focusClick.errors).toEqual([]);
		expect(focusClick.clicks).toEqual([
			{ action: "focus", url: `${origin}/` },
		]);

		// Clicking the daily notification asks the platform to open the perek
		// when no matching window is open.
		const openClick = await dispatchNotificationClick(
			worker,
			`${origin}/929/1`,
		);
		expect(openClick.errors).toEqual([]);
		expect(openClick.clicks).toEqual([
			{ action: "focus", url: `${origin}/` },
			{ action: "openWindow", url: `${origin}/929/1` },
		]);

		// The /929/1 route the click opens is asserted separately by the key
		// routes spec; paying its cold-compile cost here would double that.

		// Opt out: real DELETE removes the stored subscription — never a
		// permission prompt.
		const deleted = page.waitForResponse(
			(candidate) =>
				candidate.url().endsWith("/api/push/subscription") &&
				candidate.request().method() === "DELETE",
		);
		await disable.click();
		const deleteResponse = await deleted;
		expect(deleteResponse.status()).toBe(200);
		expect(deleteResponse.request().postDataJSON()).toMatchObject({
			endpoint: sub.endpoint,
		});
		await expect(enable).toBeEnabled();
		expect(await permissionCalls(page)).toBe(1);
	});

	test("denied permission explains the blocked state without an install funnel", async ({
		page,
		context,
	}) => {
		await context.addInitScript(installPushStub(), {
			permission: "denied" as const,
			...fakeSubscription(),
		});
		await page.goto("/");

		const section = pushSection(page);
		await expect(section).toContainText("ההתראות חסומות בדפדפן");
		await expect(section.getByRole("button")).toHaveCount(0);
		// No PWA/Home Screen copy anywhere on the page (#2936).
		await expect(page.getByText("מסך הבית")).toHaveCount(0);
	});

	test("browsers without push APIs get an accurate unavailable state, not install advice", async ({
		page,
		context,
	}) => {
		// iPhone/iPad ordinary tabs land here: Apple exposes Web Push only to
		// Home Screen web apps, so the APIs are absent and the page must say so
		// instead of funneling readers into installing (#2936).
		await context.addInitScript(installPushStub(), {
			permission: "granted" as const,
			...fakeSubscription(),
			hidePushApis: true,
		});
		await page.goto("/");

		const section = pushSection(page);
		await expect(section).toContainText("הדפדפן הזה אינו תומך בהתראות");
		await expect(section.getByRole("button")).toHaveCount(0);
		await expect(page.getByText("מסך הבית")).toHaveCount(0);
	});

	test("reader dropdown navigates to the card for the prompt and stays in sync (#3732)", async ({
		page,
		context,
		baseURL,
	}) => {
		const sub = fakeSubscription();
		await context.addInitScript(installPushStub(), {
			permission: "default" as const,
			// A "default"-permission reader can still grant the section prompt.
			permissionAnswer: "granted" as const,
			...sub,
		});
		await page.goto("/929/1");
		await page.getByRole("article").first().waitFor({ state: "visible" });

		// Opening the reader dropdown only reads state — no prompt.
		const settingsButton = page.getByRole("button", {
			name: "הגדרות קריאה",
			exact: true,
		});
		await settingsButton.click();
		const reminder = page.getByRole("checkbox", {
			name: "התראה יומית בדפדפן",
		});
		await expect(reminder).toBeVisible();
		await expect(reminder).not.toBeChecked();
		expect(await permissionCalls(page)).toBe(0);

		// Opt-in with a pending permission must not prompt from the dropdown:
		// it navigates to and focuses the dedicated section instead. "commit"
		// suffices — the assertions below poll while the homepage keeps loading.
		await reminder.click();
		await page.waitForURL(/#bulletin-push$/, { waitUntil: "commit" });
		const section = pushSection(page);
		await expect(section).toBeFocused();
		expect(await permissionCalls(page)).toBe(0);

		// The section's own enable click is the one place the prompt fires.
		const posted = page.waitForResponse(
			(response) =>
				response.url().endsWith("/api/push/subscription") &&
				response.request().method() === "POST",
		);
		await section.getByRole("button", { name: "הפעלת התראות" }).click();
		expect(await permissionCalls(page)).toBe(1);
		expect((await posted).status()).toBe(201);
		await expect(section).toContainText("ההתראה היומית פעילה");

		// Back in the reader the same state is mirrored: checked, and opt-out
		// runs the real DELETE without any permission call. Full `load` so the
		// settings button is hydrated before the click.
		await page.goto("/929/1");
		await page.getByRole("article").first().waitFor({ state: "visible" });
		await settingsButton.click();
		await expect(reminder).toBeChecked();
		expect(await permissionCalls(page)).toBe(0);
		const deleted = page.waitForResponse(
			(response) =>
				response.url().endsWith("/api/push/subscription") &&
				response.request().method() === "DELETE",
		);
		await reminder.click();
		const deleteResponse = await deleted;
		expect(deleteResponse.status()).toBe(200);
		expect(deleteResponse.request().postDataJSON()).toMatchObject({
			endpoint: sub.endpoint,
		});
		await expect(reminder).not.toBeChecked();
		expect(await permissionCalls(page)).toBe(0);

		// The card mirrors the opt-out too.
		await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
		await expect(
			section.getByRole("button", { name: "הפעלת התראות" }),
		).toBeEnabled();
	});

	test("reader dropdown enables directly when permission is already granted (#3732)", async ({
		page,
		context,
	}) => {
		const sub = fakeSubscription();
		await context.addInitScript(installPushStub(), {
			permission: "granted" as const,
			...sub,
		});
		await page.goto("/929/1");
		await page.getByRole("article").first().waitFor({ state: "visible" });
		await page
			.getByRole("button", { name: "הגדרות קריאה", exact: true })
			.click();
		const reminder = page.getByRole("checkbox", {
			name: "התראה יומית בדפדפן",
		});
		await expect(reminder).toBeVisible();

		const posted = page.waitForResponse(
			(response) =>
				response.url().endsWith("/api/push/subscription") &&
				response.request().method() === "POST",
		);
		await reminder.click();
		expect((await posted).status()).toBe(201);
		// Granted permission needs no prompt — zero calls, no navigation.
		expect(await permissionCalls(page)).toBe(0);
		expect(page.url()).toContain("/929/1");
		await expect(reminder).toBeChecked();
	});
});
