/** @jest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(
	path.resolve(__dirname, "../../../../public/sw.js"),
	"utf8",
);
const ORIGIN = "https://xn--febl3a.co.il";

type Handler = (event: unknown) => void;

function loadWorker(windows: { url: string; focus: jest.Mock }[] = []) {
	const handlers: Record<string, Handler> = {};
	const self = {
		location: { origin: ORIGIN },
		addEventListener: (type: string, handler: Handler) => {
			handlers[type] = handler;
		},
		registration: { showNotification: jest.fn().mockResolvedValue(undefined) },
		clients: {
			matchAll: jest.fn().mockResolvedValue(windows),
			openWindow: jest.fn().mockResolvedValue(undefined),
		},
	};
	new Function("self", source)(self);
	return { handlers, self };
}

async function dispatch(handler: Handler, event: Record<string, unknown>) {
	let pending: Promise<unknown> = Promise.resolve();
	handler({
		...event,
		waitUntil: (promise: Promise<unknown>) => {
			pending = promise;
		},
	});
	await pending;
}

describe("public/sw.js", () => {
	describe("push", () => {
		it("shows the payload as an RTL Hebrew notification", async () => {
			const { handlers, self } = loadWorker();
			const payload = {
				title: "t",
				body: "b",
				url: "/929/1",
				tag: "daily-perek",
			};
			await dispatch(handlers.push, { data: { json: () => payload } });
			expect(self.registration.showNotification).toHaveBeenCalledWith("t", {
				body: "b",
				icon: "/images/logos/logo192.webp",
				lang: "he",
				dir: "rtl",
				tag: "daily-perek",
				data: { url: `${ORIGIN}/929/1` },
			});
		});

		it("falls back to the site title and text body", async () => {
			const { handlers, self } = loadWorker();
			await dispatch(handlers.push, {
				data: {
					json: () => {
						throw new SyntaxError("not json");
					},
					text: () => "plain",
				},
			});
			const [title, options] = self.registration.showNotification.mock.calls[0];
			expect(title).toBe('תנ"ך על הפרק');
			expect(options.body).toBe("plain");
			expect(options.data.url).toBe(`${ORIGIN}/`);
		});

		it("handles a push without data", async () => {
			const { handlers, self } = loadWorker();
			await dispatch(handlers.push, { data: null });
			expect(self.registration.showNotification.mock.calls[0][1].body).toBe("");
		});

		it.each(["https://evil.example/x", "http://[bad"])(
			"never links off-site (%s)",
			async (url) => {
				const { handlers, self } = loadWorker();
				await dispatch(handlers.push, { data: { json: () => ({ url }) } });
				expect(
					self.registration.showNotification.mock.calls[0][1].data.url,
				).toBe(ORIGIN);
			},
		);
	});

	describe("notificationclick", () => {
		const click = (url: string) => ({
			notification: { close: jest.fn(), data: { url } },
		});

		it("focuses an open window on the perek", async () => {
			const focus = jest.fn();
			const { handlers, self } = loadWorker([
				{ url: `${ORIGIN}/929/1`, focus },
			]);
			const event = click(`${ORIGIN}/929/1`);
			await dispatch(handlers.notificationclick, event);
			expect(event.notification.close).toHaveBeenCalled();
			expect(focus).toHaveBeenCalled();
			expect(self.clients.openWindow).not.toHaveBeenCalled();
		});

		it("opens the perek otherwise", async () => {
			const { handlers, self } = loadWorker([
				{ url: `${ORIGIN}/`, focus: jest.fn() },
			]);
			await dispatch(handlers.notificationclick, click(`${ORIGIN}/929/2`));
			expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/929/2`);
		});
	});
});
