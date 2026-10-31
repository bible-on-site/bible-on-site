/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
	base64UrlToBytes,
	PushNotificationsToggle,
} from "@/app/components/PushNotificationsToggle";

const FCM = "https://fcm.googleapis.com/fcm/send/abc";

function pushSubscription() {
	return {
		endpoint: FCM,
		toJSON: () => ({ endpoint: FCM, keys: { p256dh: "p", auth: "a" } }),
		unsubscribe: jest.fn().mockResolvedValue(true),
	};
}

interface Env {
	configured?: boolean;
	supported?: boolean;
	userAgent?: string;
	permission?: NotificationPermission;
	requestPermission?: NotificationPermission;
	subscribed?: boolean;
	postOk?: boolean;
	deleteOk?: boolean;
}

function setup(env: Env = {}) {
	const {
		configured = true,
		supported = true,
		userAgent = "Mozilla/5.0 (X11; Linux x86_64) Chrome/140",
		permission = "default",
		requestPermission = "granted",
		subscribed = false,
		postOk = true,
		deleteOk = true,
	} = env;
	const existing = subscribed ? pushSubscription() : null;
	const created = pushSubscription();
	const pushManager = {
		getSubscription: jest.fn().mockResolvedValue(existing),
		subscribe: jest.fn().mockResolvedValue(created),
	};
	const serviceWorker = {
		getRegistration: jest
			.fn()
			.mockResolvedValue(subscribed ? { pushManager } : undefined),
		register: jest.fn().mockResolvedValue({ pushManager }),
		ready: Promise.resolve(),
	};
	const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
		if (!init) {
			return {
				ok: true,
				json: async () => ({ publicKey: configured ? "AQID" : null }),
			};
		}
		return { ok: init.method === "POST" ? postOk : deleteOk };
	});
	global.fetch = fetchMock as unknown as typeof fetch;
	Object.defineProperty(navigator, "userAgent", {
		configurable: true,
		value: userAgent,
	});
	window.matchMedia = jest.fn().mockReturnValue({ matches: false });
	if (supported) {
		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: serviceWorker,
		});
		Object.assign(window, {
			PushManager: class {},
			Notification: {
				permission,
				requestPermission: jest.fn().mockResolvedValue(requestPermission),
			},
		});
	}
	return { fetchMock, serviceWorker, pushManager, existing, created };
}

async function renderToggle() {
	await act(async () => {
		render(<PushNotificationsToggle />);
	});
}

async function clickToggle() {
	await act(async () => {
		fireEvent.click(screen.getByRole("checkbox"));
	});
}

describe("PushNotificationsToggle", () => {
	afterEach(() => {
		for (const key of [
			"serviceWorker",
			"userAgent",
			"platform",
			"maxTouchPoints",
		])
			Reflect.deleteProperty(navigator, key);
		Reflect.deleteProperty(window, "PushManager");
		Reflect.deleteProperty(window, "Notification");
		jest.restoreAllMocks();
	});

	describe("when push is turned off on the server", () => {
		it("renders nothing", async () => {
			setup({ configured: false });
			await renderToggle();
			expect(screen.queryByRole("status")).not.toBeInTheDocument();
		});
	});

	it("renders nothing when the status check returns an error", async () => {
		setup();
		global.fetch = jest.fn().mockResolvedValue({ ok: false });
		await renderToggle();
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});

	it("renders nothing when the status check fails", async () => {
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		setup();
		global.fetch = jest.fn().mockRejectedValue(new Error("offline"));
		await renderToggle();
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
		expect(warn).toHaveBeenCalled();
	});

	it("explains unsupported browsers", async () => {
		setup({ supported: false });
		await renderToggle();
		expect(screen.getByRole("status")).toHaveTextContent("אינו תומך");
		expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
	});

	it("asks iOS readers to add the site to the home screen", async () => {
		setup({ supported: false, userAgent: "Mozilla/5.0 (iPhone)" });
		await renderToggle();
		expect(screen.getByRole("status")).toHaveTextContent("מסך הבית");
	});

	it("treats touch-screen iPadOS as iOS", async () => {
		setup({ supported: false, userAgent: "Mozilla/5.0 (Macintosh)" });
		Object.defineProperty(navigator, "platform", {
			configurable: true,
			value: "MacIntel",
		});
		Object.defineProperty(navigator, "maxTouchPoints", {
			configurable: true,
			value: 5,
		});
		await renderToggle();
		expect(screen.getByRole("status")).toHaveTextContent("מסך הבית");
	});

	it("ignores a status check that resolves after unmount", async () => {
		setup();
		const { unmount } = render(<PushNotificationsToggle />);
		unmount();
		await act(async () => {});
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});

	it("explains blocked notifications", async () => {
		setup({ permission: "denied" });
		await renderToggle();
		expect(screen.getByRole("status")).toHaveTextContent("חסומות");
		expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
	});

	describe("when not subscribed", () => {
		it("subscribes and stores the subscription on opt-in", async () => {
			const { fetchMock, serviceWorker, pushManager } = setup();
			await renderToggle();
			expect(screen.getByRole("checkbox")).not.toBeChecked();
			await clickToggle();
			expect(serviceWorker.register).toHaveBeenCalledWith("/sw.js", {
				scope: "/",
				updateViaCache: "none",
			});
			expect(pushManager.subscribe).toHaveBeenCalledWith({
				userVisibleOnly: true,
				applicationServerKey: Uint8Array.from([1, 2, 3]),
			});
			expect(fetchMock).toHaveBeenLastCalledWith(
				"/api/push/subscription",
				expect.objectContaining({ method: "POST" }),
			);
			expect(screen.getByRole("checkbox")).toBeChecked();
			expect(screen.getByRole("status")).toHaveTextContent("פעילה");
		});

		it.each([
			["default", false],
			["denied", true],
		] as const)("stays off when permission is %s", async (answer, blocked) => {
			const { serviceWorker } = setup({ requestPermission: answer });
			await renderToggle();
			await clickToggle();
			expect(serviceWorker.register).not.toHaveBeenCalled();
			if (blocked)
				expect(screen.getByRole("status")).toHaveTextContent("חסומות");
			else expect(screen.getByRole("checkbox")).not.toBeChecked();
		});

		it("rolls back the browser subscription when the server rejects it", async () => {
			const { created } = setup({ postOk: false });
			await renderToggle();
			await clickToggle();
			expect(created.unsubscribe).toHaveBeenCalled();
			expect(screen.getByRole("status")).toHaveTextContent("נסו שוב");
		});

		it("reports an error when subscribing throws", async () => {
			const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
			const { pushManager } = setup();
			pushManager.subscribe.mockRejectedValue(new Error("AbortError"));
			await renderToggle();
			await clickToggle();
			expect(screen.getByRole("status")).toHaveTextContent("נסו שוב");
			expect(warn).toHaveBeenCalled();
		});
	});

	describe("when subscribed", () => {
		it("deletes and unsubscribes on opt-out", async () => {
			const { fetchMock, existing } = setup({ subscribed: true });
			await renderToggle();
			expect(screen.getByRole("checkbox")).toBeChecked();
			await clickToggle();
			expect(fetchMock).toHaveBeenLastCalledWith(
				"/api/push/subscription",
				expect.objectContaining({
					method: "DELETE",
					body: JSON.stringify({ endpoint: FCM }),
				}),
			);
			expect(existing?.unsubscribe).toHaveBeenCalled();
			expect(screen.getByRole("checkbox")).not.toBeChecked();
		});

		it("keeps the subscription when the server delete fails", async () => {
			const { existing } = setup({ subscribed: true, deleteOk: false });
			await renderToggle();
			await clickToggle();
			expect(existing?.unsubscribe).not.toHaveBeenCalled();
			expect(screen.getByRole("status")).toHaveTextContent("נסו שוב");
		});
	});

	it("turns off without a request when the subscription is already gone", async () => {
		const { fetchMock, serviceWorker } = setup({ subscribed: true });
		await renderToggle();
		serviceWorker.getRegistration.mockResolvedValue(undefined);
		await clickToggle();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("checkbox")).not.toBeChecked();
	});
});

describe("base64UrlToBytes", () => {
	it("decodes unpadded base64url", () => {
		expect(base64UrlToBytes("-_8")).toEqual(Uint8Array.from([251, 255]));
	});
});
