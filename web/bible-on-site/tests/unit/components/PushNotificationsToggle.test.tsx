/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PushNotificationsToggle } from "@/app/components/PushNotificationsToggle";
import {
	base64UrlToBytes,
	PUSH_SECTION_ID,
	PUSH_STATUS_EVENT,
} from "@/lib/push-notifications";

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
	const requestPermissionMock = jest.fn().mockResolvedValue(requestPermission);
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
	if (supported) {
		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: serviceWorker,
		});
		Object.assign(window, {
			PushManager: class {},
			Notification: {
				permission,
				requestPermission: requestPermissionMock,
			},
		});
	}
	return {
		fetchMock,
		serviceWorker,
		pushManager,
		existing,
		created,
		requestPermissionMock,
	};
}

const card = () => document.getElementById(PUSH_SECTION_ID);
const enableButton = () => screen.getByRole("button", { name: "הפעלת התראות" });
const disableButton = () =>
	screen.getByRole("button", { name: "ביטול התראות" });

async function renderToggle() {
	await act(async () => {
		render(<PushNotificationsToggle />);
	});
}

async function click(name: string) {
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name }));
	});
}

describe("PushNotificationsToggle", () => {
	afterEach(() => {
		for (const key of ["serviceWorker"])
			Reflect.deleteProperty(navigator, key);
		Reflect.deleteProperty(window, "PushManager");
		Reflect.deleteProperty(window, "Notification");
		window.location.hash = "";
		jest.restoreAllMocks();
	});

	describe("when push is turned off on the server", () => {
		it("renders nothing", async () => {
			setup({ configured: false });
			await renderToggle();
			expect(card()).toBeNull();
			expect(screen.queryByRole("status")).not.toBeInTheDocument();
		});
	});

	it("renders nothing when the status check returns an error", async () => {
		setup();
		global.fetch = jest.fn().mockResolvedValue({ ok: false });
		await renderToggle();
		expect(card()).toBeNull();
	});

	it("renders nothing when the status check fails", async () => {
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		setup();
		global.fetch = jest.fn().mockRejectedValue(new Error("offline"));
		await renderToggle();
		expect(card()).toBeNull();
		expect(warn).toHaveBeenCalled();
	});

	it("explains unsupported browsers without action controls", async () => {
		setup({ supported: false });
		await renderToggle();
		expect(card()).not.toBeNull();
		expect(screen.getByRole("status")).toHaveTextContent("אינו תומך");
		expect(
			screen.queryByRole("button", { name: "הפעלת התראות" }),
		).not.toBeInTheDocument();
	});

	it("ignores a status check that resolves after unmount", async () => {
		setup();
		const { unmount } = render(<PushNotificationsToggle />);
		unmount();
		await act(async () => {});
		expect(card()).toBeNull();
	});

	it("explains blocked notifications without action controls", async () => {
		setup({ permission: "denied" });
		await renderToggle();
		expect(screen.getByRole("status")).toHaveTextContent("חסומות");
		expect(
			screen.queryByRole("button", { name: "הפעלת התראות" }),
		).not.toBeInTheDocument();
	});

	it("never requests permission on load", async () => {
		const { requestPermissionMock } = setup();
		await renderToggle();
		expect(requestPermissionMock).not.toHaveBeenCalled();
	});

	it("anchors the card for the dropdown's navigation target", async () => {
		setup();
		await renderToggle();
		expect(card()?.id).toBe(PUSH_SECTION_ID);
		expect(card()).toHaveAttribute("tabIndex", "-1");
		expect(screen.getByRole("heading", { name: "דפדפן" })).toBeInTheDocument();
	});

	it("focuses the card when navigated to via its hash", async () => {
		setup();
		window.location.hash = `#${PUSH_SECTION_ID}`;
		await renderToggle();
		expect(card()).toHaveFocus();
	});

	describe("when not subscribed", () => {
		it("shows the off state with enable available and disable inert", async () => {
			setup();
			await renderToggle();
			expect(enableButton()).toBeEnabled();
			expect(disableButton()).toBeDisabled();
		});

		it("requests permission once from the enable click and subscribes", async () => {
			const { fetchMock, serviceWorker, pushManager, requestPermissionMock } =
				setup();
			await renderToggle();
			await click("הפעלת התראות");
			expect(requestPermissionMock).toHaveBeenCalledTimes(1);
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
			expect(screen.getByRole("status")).toHaveTextContent("פעילה");
			expect(enableButton()).toBeDisabled();
			expect(disableButton()).toBeEnabled();
		});

		it.each([
			["default", false],
			["denied", true],
		] as const)("stays off when permission is %s", async (answer, blocked) => {
			const { serviceWorker } = setup({ requestPermission: answer });
			await renderToggle();
			await click("הפעלת התראות");
			expect(serviceWorker.register).not.toHaveBeenCalled();
			if (blocked) {
				expect(screen.getByRole("status")).toHaveTextContent("חסומות");
				expect(
					screen.queryByRole("button", { name: "הפעלת התראות" }),
				).not.toBeInTheDocument();
			} else {
				expect(enableButton()).toBeEnabled();
			}
		});

		it("rolls back the browser subscription when the server rejects it", async () => {
			const { created } = setup({ postOk: false });
			await renderToggle();
			await click("הפעלת התראות");
			expect(created.unsubscribe).toHaveBeenCalled();
			expect(screen.getByRole("status")).toHaveTextContent("נסו שוב");
		});

		it("reports an error when subscribing throws", async () => {
			const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
			const { pushManager } = setup();
			pushManager.subscribe.mockRejectedValue(new Error("AbortError"));
			await renderToggle();
			await click("הפעלת התראות");
			expect(screen.getByRole("status")).toHaveTextContent("נסו שוב");
			expect(warn).toHaveBeenCalled();
		});
	});

	describe("when subscribed", () => {
		it("shows the on state with disable available and enable inert", async () => {
			setup({ subscribed: true });
			await renderToggle();
			expect(screen.getByRole("status")).toHaveTextContent("פעילה");
			expect(disableButton()).toBeEnabled();
			expect(enableButton()).toBeDisabled();
		});

		it("deletes and unsubscribes on opt-out without a permission call", async () => {
			const { fetchMock, existing, requestPermissionMock } = setup({
				subscribed: true,
			});
			await renderToggle();
			await click("ביטול התראות");
			expect(requestPermissionMock).not.toHaveBeenCalled();
			expect(fetchMock).toHaveBeenLastCalledWith(
				"/api/push/subscription",
				expect.objectContaining({
					method: "DELETE",
					body: JSON.stringify({ endpoint: FCM }),
				}),
			);
			expect(existing?.unsubscribe).toHaveBeenCalled();
			expect(enableButton()).toBeEnabled();
		});

		it("keeps the subscription when the server delete fails", async () => {
			const { existing } = setup({ subscribed: true, deleteOk: false });
			await renderToggle();
			await click("ביטול התראות");
			expect(existing?.unsubscribe).not.toHaveBeenCalled();
			expect(screen.getByRole("status")).toHaveTextContent("נסו שוב");
		});
	});

	it("turns off without a request when the subscription is already gone", async () => {
		const { fetchMock, serviceWorker } = setup({ subscribed: true });
		await renderToggle();
		serviceWorker.getRegistration.mockResolvedValue(undefined);
		await click("ביטול התראות");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(enableButton()).toBeEnabled();
	});

	it("broadcasts status changes so other mounted surfaces stay in sync", async () => {
		setup();
		const events: string[] = [];
		window.addEventListener(PUSH_STATUS_EVENT, (event) =>
			events.push((event as CustomEvent<string>).detail),
		);
		await renderToggle();
		await click("הפעלת התראות");
		expect(events).toEqual(["on"]);
	});
});

describe("base64UrlToBytes", () => {
	it("decodes unpadded base64url", () => {
		expect(base64UrlToBytes("-_8")).toEqual(Uint8Array.from([251, 255]));
	});
});
