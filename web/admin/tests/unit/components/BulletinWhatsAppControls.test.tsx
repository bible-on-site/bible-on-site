import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BulletinWhatsAppControls } from "~/components/BulletinWhatsAppControls";
import type {
	BulletinWhatsAppState,
	WhatsAppJobSummary,
} from "~/lib/bulletin-whatsapp";

const mocks = vi.hoisted(() => ({
	read: vi.fn(),
	verify: vi.fn(),
	queue: vi.fn(),
	audience: vi.fn(),
}));
vi.mock("~/server/bulletin-whatsapp", () => ({
	getDailyBulletinWhatsApp: mocks.read,
	verifyDailyBulletinWhatsApp: mocks.verify,
	queueDailyBulletinWhatsApp: mocks.queue,
	updateDailyBulletinWhatsAppAudience: mocks.audience,
}));

const DATE = "2026-10-28";
const NEXT_DATE = "2026-10-29";
const NOW = "2026-10-28T12:00:00Z";
const KEY = "11111111-1111-4111-8111-111111111111";
const NEXT_KEY = "22222222-2222-4222-8222-222222222222";
function ready(real = false): BulletinWhatsAppState {
	return {
		settings: { audience: "test", revision: 4 },
		readiness: {
			configured: true,
			canSend: true,
			canUseReal: real,
			blockers: [],
		},
		testTarget: {
			title: "קבוצת ניסיון לדוגמה",
			memberCount: 2,
			verifiedAt: NOW,
		},
		realTarget: real
			? { title: "קבוצת לימוד לדוגמה", memberCount: 80, verifiedAt: NOW }
			: null,
		verification: {
			connectionState: "authorized",
			checkedAt: NOW,
			expiresAt: "2026-10-28T12:10:00Z",
		},
		audienceLocked: false,
		job: null,
	};
}
function job(
	status: WhatsAppJobSummary["status"],
	overrides: Partial<WhatsAppJobSummary> = {},
): WhatsAppJobSummary {
	return {
		id: "whatsapp-job-1",
		date: DATE,
		audience: "test",
		status,
		createdAt: NOW,
		sentAt: status === "sent" ? NOW : null,
		error: null,
		...overrides,
	};
}
function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	let reject: (reason: Error) => void = () => {};
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
let serverState: BulletinWhatsAppState;
function view({ date = DATE, prepared = true, disabled = false } = {}) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const busy = vi.fn();
	const element = (value: string, pdf = prepared, blocked = disabled) => (
		<QueryClientProvider client={client}>
			<BulletinWhatsAppControls
				date={value}
				prepared={pdf}
				disabled={blocked}
				onBusyChange={busy}
			/>
		</QueryClientProvider>
	);
	const mounted = render(element(date));
	return {
		client,
		busy,
		rerender: (value = date, pdf = prepared, blocked = disabled) =>
			mounted.rerender(element(value, pdf, blocked)),
	};
}
const send = () => screen.getByRole("button", { name: "שליחת ניסיון בווטסאפ" });
const check = () => screen.getByRole("button", { name: "בדיקת חיבור" });
const save = () => screen.getByRole("button", { name: "שמירת יעד הווטסאפ" });
const loaded = () => screen.findByText("קבוצת ניסיון לדוגמה");
const selectReal = () =>
	fireEvent.change(screen.getByLabelText("יעד השליחה בווטסאפ"), {
		target: { value: "real" },
	});

describe("independent WhatsApp bulletin controls", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(NOW));
		vi.spyOn(crypto, "randomUUID").mockReturnValue(KEY);
		serverState = ready();
		mocks.read
			.mockReset()
			.mockImplementation(() => Promise.resolve(serverState));
		mocks.verify
			.mockReset()
			.mockImplementation(() => Promise.resolve(serverState));
		mocks.queue.mockReset().mockImplementation(({ data }) => {
			const queued = job("queued", {
				date: data.date,
				audience: data.expectedAudience,
			});
			serverState = { ...serverState, job: queued, audienceLocked: true };
			return Promise.resolve(queued);
		});
		mocks.audience.mockReset().mockImplementation(({ data }) => {
			const settings = {
				audience: data.audience,
				revision: data.expectedRevision + 1,
			};
			serverState = { ...serverState, settings, job: null };
			return Promise.resolve(settings);
		});
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("loads only cached state, shows group metadata and keeps the missing real group disabled", async () => {
		view();
		await loaded();
		expect(screen.getByLabelText("יעד השליחה בווטסאפ")).toHaveValue("test");
		expect(screen.getByText("2 משתתפים")).toBeVisible();
		expect(screen.getByText("החשבון מחובר")).toBeVisible();
		expect(
			screen.getByRole("option", { name: "הקבוצה הרגילה" }),
		).toBeDisabled();
		expect(screen.getByText(/קהל הווטסאפ נשמר בנפרד/)).toBeVisible();
		expect(send()).toBeEnabled();
		expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ data: DATE });
		expect(mocks.verify).not.toHaveBeenCalled();
		expect(mocks.queue).not.toHaveBeenCalled();
		expect(mocks.audience).not.toHaveBeenCalled();
		expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
	});
	it("does not invent test mode while loading or when the database read fails", async () => {
		mocks.read.mockReturnValue(new Promise(() => {}));
		view();
		expect(screen.getByRole("status")).toHaveTextContent("טוען הגדרות ווטסאפ");
		expect(
			screen.getByRole("button", { name: "שליחת העלון בווטסאפ" }),
		).toBeDisabled();
		expect(screen.queryByText(/מצב ניסיון/)).not.toBeInTheDocument();
		cleanup();
		mocks.read.mockRejectedValue(new Error("private database details"));
		view();
		await screen.findByText(/קהל השליחה אינו ידוע/);
		expect(screen.queryByText(/מצב ניסיון/)).not.toBeInTheDocument();
		expect(screen.queryByText(/private database/)).not.toBeInTheDocument();
		expect(check()).toBeDisabled();
	});
	it("retains the persisted real audience when provider configuration is unavailable", async () => {
		serverState = {
			...ready(),
			settings: { audience: "real", revision: 9 },
			readiness: {
				configured: false,
				canSend: false,
				canUseReal: false,
				blockers: ["החיבור טרם הוגדר"],
			},
		};
		view();
		await loaded();
		expect(screen.getByText("מצב שליחה לקבוצה הרגילה")).toBeVisible();
		expect(screen.getByLabelText("יעד השליחה בווטסאפ")).toHaveValue("real");
		expect(screen.getByText("החיבור טרם הוגדר")).toBeVisible();
		expect(
			screen.getByRole("button", { name: "שליחת העלון לקבוצה הרגילה" }),
		).toBeDisabled();
	});
	it("checks connection explicitly, preserves the date and never sends a bulletin", async () => {
		const waiting = deferred<BulletinWhatsAppState>();
		mocks.verify.mockReturnValue(waiting.promise);
		const { busy } = view({ prepared: false });
		await loaded();
		const button = check();
		fireEvent.click(button);
		fireEvent.click(button);
		await waitFor(() =>
			expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({ data: DATE }),
		);
		expect(busy).toHaveBeenLastCalledWith(true);
		await act(async () =>
			waiting.resolve({
				...ready(),
				verification: {
					connectionState: "suspended",
					checkedAt: NOW,
					expiresAt: null,
				},
				readiness: {
					configured: true,
					canSend: false,
					canUseReal: false,
					blockers: ["החשבון הושהה"],
				},
			}),
		);
		await screen.findByText("השליחה מהחשבון הושהתה");
		expect(check()).toBeEnabled();
		expect(mocks.queue).not.toHaveBeenCalled();
		expect(mocks.audience).not.toHaveBeenCalled();
	});
	it("shows a deferred verification and allows another deliberate check without automatic retry", async () => {
		mocks.verify.mockResolvedValueOnce({
			...ready(),
			readiness: {
				...ready().readiness,
				canSend: false,
				blockers: ["בדיקה נוספת מתבצעת כעת"],
			},
		});
		view();
		await loaded();
		fireEvent.click(check());
		await screen.findByText("בדיקה נוספת מתבצעת כעת");
		expect(send()).toBeDisabled();
		expect(mocks.verify).toHaveBeenCalledOnce();
		fireEvent.click(check());
		await waitFor(() => expect(mocks.verify).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(send()).toBeEnabled());
	});
	it("blocks sending without an immutable prepared PDF while permitting connection checks", async () => {
		view({ prepared: false });
		await loaded();
		expect(send()).toBeDisabled();
		expect(check()).toBeEnabled();
		expect(screen.getByText(/יש להכין את העלון ואת קובץ/)).toBeVisible();
		fireEvent.click(send());
		expect(mocks.queue).not.toHaveBeenCalled();
	});
	it("captures the test audience/revision/key once and locks other actions during enqueue", async () => {
		const waiting = deferred<WhatsAppJobSummary>();
		mocks.queue.mockReturnValue(waiting.promise);
		const { busy, client } = view();
		await loaded();
		fireEvent.click(send());
		await waitFor(() => expect(mocks.queue).toHaveBeenCalledOnce());
		expect(mocks.queue).toHaveBeenCalledWith({
			data: {
				date: DATE,
				requestKey: KEY,
				expectedAudience: "test",
				expectedRevision: 4,
			},
		});
		expect(screen.getByLabelText("יעד השליחה בווטסאפ")).toBeDisabled();
		expect(check()).toBeDisabled();
		expect(busy).toHaveBeenLastCalledWith(true);
		await act(async () => waiting.resolve(job("accepted")));
		await screen.findByText(/ממתין לאישור שליחה/);
		expect(
			client.getQueryData<BulletinWhatsAppState>(["bulletin-whatsapp", DATE])
				?.job?.status,
		).toBe("accepted");
		expect(client.getQueryData(["bulletin-email", DATE])).toBeUndefined();
		expect(
			screen.queryByText(/^ניסיון בווטסאפ: נשלח לקבוצה$/),
		).not.toBeInTheDocument();
	});
	it("requires a configured verified real group, confirmation and an explicit save", async () => {
		serverState = ready(true);
		view();
		await loaded();
		selectReal();
		expect(save()).toBeDisabled();
		expect(send()).toBeDisabled();
		expect(mocks.audience).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: /אני מאשר מעבר לשליחה לקבוצה הרגילה/,
			}),
		);
		fireEvent.click(save());
		await waitFor(() =>
			expect(mocks.audience).toHaveBeenCalledExactlyOnceWith({
				data: { audience: "real", expectedRevision: 4, confirmReal: true },
			}),
		);
		const realSend = await screen.findByRole("button", {
			name: "שליחת העלון לקבוצה הרגילה",
		});
		await waitFor(() => expect(realSend).toBeEnabled());
		fireEvent.click(realSend);
		await waitFor(() =>
			expect(mocks.queue).toHaveBeenCalledExactlyOnceWith({
				data: {
					date: DATE,
					requestKey: KEY,
					expectedAudience: "real",
					expectedRevision: 5,
				},
			}),
		);
	});
	it("can return to test without a real target or real confirmation", async () => {
		serverState = { ...ready(), settings: { audience: "real", revision: 6 } };
		view();
		await loaded();
		fireEvent.change(screen.getByLabelText("יעד השליחה בווטסאפ"), {
			target: { value: "test" },
		});
		fireEvent.click(save());
		await waitFor(() =>
			expect(mocks.audience).toHaveBeenCalledExactlyOnceWith({
				data: { audience: "test", expectedRevision: 6, confirmReal: false },
			}),
		);
		await waitFor(() => expect(send()).toBeEnabled());
	});
	it("locks audience changes for a durable job on another date", async () => {
		serverState = { ...ready(true), audienceLocked: true };
		view();
		await loaded();
		expect(screen.getByLabelText("יעד השליחה בווטסאפ")).toBeDisabled();
		expect(send()).toBeDisabled();
		expect(screen.getByText(/יש משלוח שטרם הסתיים/)).toBeVisible();
	});
	it.each(["queued", "sending", "accepted", "uncertain"] as const)(
		"does not resend or mint another key for a %s outcome",
		async (status) => {
			serverState = { ...ready(true), job: job(status), audienceLocked: true };
			view();
			await loaded();
			expect(send()).toBeDisabled();
			expect(
				screen.queryByRole("button", { name: "ניסיון ווטסאפ חדש" }),
			).not.toBeInTheDocument();
			fireEvent.click(send());
			expect(mocks.queue).not.toHaveBeenCalled();
			expect(crypto.randomUUID).not.toHaveBeenCalled();
		},
	);
	it.each(["sent", "failed", "suppressed"] as const)(
		"requires a deliberate new test after a terminal %s job",
		async (status) => {
			serverState = {
				...ready(),
				job: job(status, {
					error: status === "failed" ? "הקובץ לא נשלח" : null,
				}),
			};
			view();
			await loaded();
			expect(send()).toBeDisabled();
			vi.mocked(crypto.randomUUID).mockReturnValue(NEXT_KEY);
			fireEvent.click(
				screen.getByRole("button", { name: "ניסיון ווטסאפ חדש" }),
			);
			expect(send()).toBeEnabled();
			fireEvent.click(send());
			await waitFor(() =>
				expect(mocks.queue).toHaveBeenCalledExactlyOnceWith({
					data: {
						date: DATE,
						requestKey: NEXT_KEY,
						expectedAudience: "test",
						expectedRevision: 4,
					},
				}),
			);
		},
	);
	it("never offers another production send after a completed real job", async () => {
		serverState = {
			...ready(true),
			settings: { audience: "real", revision: 5 },
			job: job("sent", { audience: "real" }),
		};
		view();
		await loaded();
		expect(
			screen.getByRole("button", { name: "שליחת העלון לקבוצה הרגילה" }),
		).toBeDisabled();
		expect(
			screen.queryByRole("button", { name: "ניסיון ווטסאפ חדש" }),
		).not.toBeInTheDocument();
	});
	it("blocks an expired cached verification without polling the provider", async () => {
		serverState = {
			...ready(),
			verification: {
				connectionState: "authorized",
				checkedAt: "2026-10-28T11:00:00Z",
				expiresAt: "2026-10-28T11:10:00Z",
			},
		};
		view();
		await loaded();
		expect(send()).toBeDisabled();
		expect(screen.getByText(/תוקף הבדיקה פג/)).toBeVisible();
		expect(check()).toBeEnabled();
		expect(mocks.verify).not.toHaveBeenCalled();
	});
	it("expires the displayed verification locally without a background provider request", async () => {
		vi.useFakeTimers();
		serverState = {
			...ready(),
			verification: {
				...ready().verification,
				expiresAt: "2026-10-28T12:00:01Z",
			},
		};
		view();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(send()).toBeEnabled();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1001);
		});
		expect(send()).toBeDisabled();
		expect(mocks.verify).not.toHaveBeenCalled();
	});
	it("blocks an ambiguous request until a clean refresh, then retries only its retained key deliberately", async () => {
		mocks.queue.mockRejectedValue(new Error("private upstream token details"));
		view();
		await loaded();
		fireEvent.click(send());
		await screen.findByText(/שליחה נוספת חסומה עד לבדיקת המשלוח/);
		expect(send()).toBeDisabled();
		fireEvent.click(send());
		fireEvent.click(screen.getByRole("button", { name: "רענון מצב הווטסאפ" }));
		await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(3));
		expect(mocks.queue).toHaveBeenCalledOnce();
		expect(crypto.randomUUID).toHaveBeenCalledOnce();
		expect(screen.queryByText(/private upstream/)).not.toBeInTheDocument();
		await waitFor(() => expect(send()).toBeEnabled());
		vi.mocked(crypto.randomUUID).mockReturnValue(NEXT_KEY);
		fireEvent.click(send());
		await waitFor(() => expect(mocks.queue).toHaveBeenCalledTimes(2));
		expect(mocks.queue.mock.calls[1][0]).toEqual(mocks.queue.mock.calls[0][0]);
		expect(mocks.queue.mock.calls[1][0].data.requestKey).toBe(KEY);
		expect(crypto.randomUUID).toHaveBeenCalledOnce();
	});
	it("does not unlock a failed enqueue after another failed state read", async () => {
		mocks.queue.mockRejectedValue(new Error("network failure"));
		view();
		await loaded();
		fireEvent.click(send());
		await screen.findByText(/שליחה נוספת חסומה עד לבדיקת המשלוח/);
		await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
		mocks.read.mockRejectedValue(new Error("read failure"));
		fireEvent.click(screen.getByRole("button", { name: "רענון מצב הווטסאפ" }));
		await screen.findByText(/קהל השליחה אינו ידוע/);
		fireEvent.click(
			screen.getByRole("button", { name: "שליחת העלון בווטסאפ" }),
		);
		expect(mocks.queue).toHaveBeenCalledOnce();
		expect(crypto.randomUUID).toHaveBeenCalledOnce();
	});
	it.each(["queued", "sending", "accepted", "uncertain"] as const)(
		"keeps a durable %s job blocked after refreshing an ambiguous enqueue",
		async (status) => {
			mocks.queue.mockRejectedValue(new Error("response lost"));
			view();
			await loaded();
			fireEvent.click(send());
			await screen.findByText(/שליחה נוספת חסומה עד לבדיקת המשלוח/);
			await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
			serverState = { ...ready(), job: job(status), audienceLocked: true };
			fireEvent.click(
				screen.getByRole("button", { name: "רענון מצב הווטסאפ" }),
			);
			await waitFor(() =>
				expect(
					screen.queryByText(/שליחה נוספת חסומה עד לבדיקת המשלוח/),
				).not.toBeInTheDocument(),
			);
			expect(send()).toBeDisabled();
			fireEvent.click(send());
			expect(mocks.queue).toHaveBeenCalledOnce();
			expect(crypto.randomUUID).toHaveBeenCalledOnce();
		},
	);
	it("refreshes after a failed audience CAS without presenting the requested mode as saved", async () => {
		serverState = ready(true);
		mocks.audience.mockRejectedValue(
			new Error("private stale revision details"),
		);
		view();
		await loaded();
		selectReal();
		fireEvent.click(screen.getByRole("checkbox", { name: /אני מאשר מעבר/ }));
		fireEvent.click(save());
		await screen.findByText(/שינוי הקבוצה לא אושר/);
		expect(screen.getByText("מצב ניסיון - קבוצת הניסיון בלבד")).toBeVisible();
		expect(send()).toBeDisabled();
		expect(screen.queryByText(/private stale/)).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "רענון מצב הווטסאפ" }));
		await waitFor(() =>
			expect(
				screen.queryByText(/שינוי הקבוצה לא אושר/),
			).not.toBeInTheDocument(),
		);
	});
	it("shows a safe verification failure and permits a deliberate next check", async () => {
		mocks.verify.mockRejectedValueOnce(new Error("private transport endpoint"));
		view();
		await loaded();
		fireEvent.click(check());
		await screen.findByText(/בדיקת החיבור לא הושלמה/);
		expect(send()).toBeDisabled();
		fireEvent.click(check());
		await waitFor(() => expect(mocks.verify).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(send()).toBeEnabled());
		expect(screen.queryByText(/private transport/)).not.toBeInTheDocument();
	});
	it("keeps a late verification tied to its requested date", async () => {
		const waiting = deferred<BulletinWhatsAppState>();
		mocks.verify.mockReturnValue(waiting.promise);
		const mounted = view();
		await loaded();
		fireEvent.click(check());
		await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce());
		mounted.rerender(NEXT_DATE);
		await waitFor(() =>
			expect(mocks.read).toHaveBeenCalledWith({ data: NEXT_DATE }),
		);
		await act(async () =>
			waiting.resolve({
				...ready(),
				testTarget: {
					title: "קבוצה שנבדקה לתאריך הקודם",
					memberCount: 2,
					verifiedAt: NOW,
				},
			}),
		);
		expect(
			mounted.client.getQueryData<BulletinWhatsAppState>([
				"bulletin-whatsapp",
				DATE,
			])?.testTarget?.title,
		).toBe("קבוצה שנבדקה לתאריך הקודם");
		expect(
			mounted.client.getQueryData<BulletinWhatsAppState>([
				"bulletin-whatsapp",
				NEXT_DATE,
			])?.testTarget?.title,
		).toBe("קבוצת ניסיון לדוגמה");
	});
	it("does not let an old GET replace a newer persisted audience revision", async () => {
		const waiting = deferred<BulletinWhatsAppState>();
		mocks.read.mockReturnValueOnce(waiting.promise);
		const { client } = view();
		await act(async () => {
			client.setQueryData(["bulletin-whatsapp", DATE], {
				...ready(true),
				settings: { audience: "real", revision: 8 },
			});
		});
		await act(async () => waiting.resolve(ready()));
		expect(await screen.findByText("מצב שליחה לקבוצה הרגילה")).toBeVisible();
		expect(
			client.getQueryData<BulletinWhatsAppState>(["bulletin-whatsapp", DATE])
				?.settings.revision,
		).toBe(8);
	});
	it("cancels a cached read that finishes after a fresh explicit verification", async () => {
		const verification = deferred<BulletinWhatsAppState>();
		const cachedRead = deferred<BulletinWhatsAppState>();
		mocks.verify.mockReturnValue(verification.promise);
		const { client } = view();
		await loaded();
		fireEvent.click(check());
		await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce());
		mocks.read.mockReturnValueOnce(cachedRead.promise);
		let reading: Promise<void>;
		await act(async () => {
			reading = client.refetchQueries({
				queryKey: ["bulletin-whatsapp", DATE],
			});
		});
		const verified: BulletinWhatsAppState = {
			...ready(),
			testTarget: {
				title: "שם מעודכן לאחר בדיקה",
				memberCount: 3,
				verifiedAt: "2026-10-28T12:01:00Z",
			},
		};
		await act(async () => verification.resolve(verified));
		await screen.findByText("שם מעודכן לאחר בדיקה");
		await act(async () => {
			cachedRead.resolve(ready());
			await reading;
		});
		expect(screen.getByText("שם מעודכן לאחר בדיקה")).toBeVisible();
		expect(screen.getByText("3 משתתפים")).toBeVisible();
		expect(mocks.verify).toHaveBeenCalledOnce();
	});
	it("does not let a late verification restore an older audience revision", async () => {
		const waiting = deferred<BulletinWhatsAppState>();
		mocks.verify.mockReturnValue(waiting.promise);
		const { client } = view();
		await loaded();
		fireEvent.click(check());
		await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce());
		await act(async () => {
			client.setQueryData(["bulletin-whatsapp", DATE], {
				...ready(true),
				settings: { audience: "real", revision: 9 },
			});
			waiting.resolve(ready());
		});
		await screen.findByText("מצב שליחה לקבוצה הרגילה");
		expect(
			client.getQueryData<BulletinWhatsAppState>(["bulletin-whatsapp", DATE])
				?.settings.revision,
		).toBe(9);
	});
	it("ignores a late queue response after a newer audience revision has reached the cache", async () => {
		const waiting = deferred<WhatsAppJobSummary>();
		mocks.queue.mockReturnValue(waiting.promise);
		const { client } = view();
		await loaded();
		fireEvent.click(send());
		await waitFor(() => expect(mocks.queue).toHaveBeenCalledOnce());
		await act(async () => {
			client.setQueryData(["bulletin-whatsapp", DATE], {
				...ready(true),
				settings: { audience: "real", revision: 9 },
			});
		});
		await act(async () => waiting.resolve(job("queued")));
		expect(
			client.getQueryData<BulletinWhatsAppState>(["bulletin-whatsapp", DATE])
				?.settings.revision,
		).toBe(9);
		expect(
			client.getQueryData<BulletinWhatsAppState>(["bulletin-whatsapp", DATE])
				?.job,
		).toBeNull();
	});
	it("clears local mode choices on a date change and obeys sibling activity", async () => {
		serverState = ready(true);
		const mounted = view();
		await loaded();
		selectReal();
		mounted.rerender(NEXT_DATE, true, true);
		await waitFor(() =>
			expect(screen.getByLabelText("יעד השליחה בווטסאפ")).toHaveValue("test"),
		);
		expect(send()).toBeDisabled();
		expect(check()).toBeDisabled();
	});
});
