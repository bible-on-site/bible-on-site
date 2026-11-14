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
import { BulletinTelegramControls } from "~/components/BulletinTelegramControls";
import type {
	BulletinTelegramState,
	TelegramJobSummary,
} from "~/lib/bulletin-telegram";
import { deferred } from "../../util/deferred";

const mocks = vi.hoisted(() => ({
	read: vi.fn(),
	queue: vi.fn(),
	audience: vi.fn(),
}));
vi.mock("~/server/bulletin-telegram", () => ({
	getDailyBulletinTelegram: mocks.read,
	queueDailyBulletinTelegram: mocks.queue,
	setDailyBulletinTelegramAudience: mocks.audience,
}));
const DATE = "2026-10-28";
const NEXT_DATE = "2026-10-29";
const KEY = "11111111-1111-4111-8111-111111111111";
const NEXT_KEY = "22222222-2222-4222-8222-222222222222";
function ready(): BulletinTelegramState {
	return {
		settings: { audience: "test", revision: 4 },
		readiness: {
			configured: true,
			canSend: true,
			canUseReal: true,
			blockers: [],
		},
		testTarget: { title: "יעד ניסיון פרטי לדוגמה", username: null },
		realTarget: { title: 'תנ"ך על הפרק', username: "alhaperek" },
		job: null,
	};
}
function job(
	status: TelegramJobSummary["status"],
	overrides: Partial<TelegramJobSummary> = {},
): TelegramJobSummary {
	return {
		id: "telegram-job-1",
		date: DATE,
		audience: "test",
		status,
		createdAt: "2026-10-28T12:00:00Z",
		sentAt: status === "sent" ? "2026-10-28T12:00:01Z" : null,
		error: null,
		...overrides,
	};
}
let serverState: BulletinTelegramState;
function view(date = DATE, disabled = false) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const busy = vi.fn();
	const element = (value: string) => (
		<QueryClientProvider client={client}>
			<BulletinTelegramControls
				date={value}
				disabled={disabled}
				onBusyChange={busy}
			/>
		</QueryClientProvider>
	);
	const mounted = render(element(date));
	return {
		client,
		busy,
		rerender: (value: string) => mounted.rerender(element(value)),
	};
}
const send = () => screen.getByRole("button", { name: "שליחת ניסיון בטלגרם" });
const selectReal = () =>
	fireEvent.change(screen.getByLabelText("יעד השליחה בטלגרם"), {
		target: { value: "real" },
	});
const saveMode = () => screen.getByRole("button", { name: "שמירת יעד הטלגרם" });
const loaded = () => screen.findByText("יעד ניסיון פרטי לדוגמה");

describe("independent Telegram bulletin controls", () => {
	beforeEach(() => {
		serverState = ready();
		vi.spyOn(crypto, "randomUUID").mockReturnValue(KEY);
		mocks.read
			.mockReset()
			.mockImplementation(() => Promise.resolve(serverState));
		mocks.queue.mockReset().mockImplementation(({ data }) => {
			const queued = job("queued", {
				date: data.date,
				audience: data.expectedAudience,
			});
			serverState = { ...serverState, job: queued };
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

	it("loads persisted test mode, names both targets and sends no automatic request", async () => {
		view();
		await loaded();
		expect(screen.getByLabelText("יעד השליחה בטלגרם")).toHaveValue("test");
		expect(screen.getByText("@alhaperek")).toHaveAttribute("dir", "ltr");
		expect(screen.getByText(/מצב הטלגרם נשמר בנפרד/)).toBeVisible();
		expect(send()).toBeEnabled();
		expect(mocks.read).toHaveBeenCalledWith({ data: DATE });
		expect(mocks.queue).not.toHaveBeenCalled();
		expect(mocks.audience).not.toHaveBeenCalled();
		expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
	});

	it("fails closed during loading and shows missing configuration blockers", async () => {
		mocks.read.mockReturnValueOnce(new Promise(() => {}));
		view();
		expect(screen.getByRole("status")).toHaveTextContent("טוען הגדרות טלגרם");
		expect(send()).toBeDisabled();
		cleanup();
		serverState = {
			...ready(),
			testTarget: null,
			realTarget: null,
			readiness: {
				configured: false,
				canSend: false,
				canUseReal: false,
				blockers: ["ערוץ הניסיון טרם הוגדר"],
			},
		};
		view();
		await screen.findByText("ערוץ הניסיון טרם הוגדר");
		expect(send()).toBeDisabled();
		expect(
			screen.getByRole("option", { name: "הערוץ הציבורי" }),
		).toBeDisabled();
	});

	it("queues only the captured private date/audience/revision and locks changes while pending", async () => {
		let finish: (value: TelegramJobSummary) => void = () => {};
		mocks.queue.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		const { busy, client } = view();
		await loaded();
		fireEvent.click(send());
		await waitFor(() => expect(busy).toHaveBeenLastCalledWith(true));
		expect(screen.getByLabelText("יעד השליחה בטלגרם")).toBeDisabled();
		expect(mocks.queue).toHaveBeenCalledExactlyOnceWith({
			data: {
				date: DATE,
				requestKey: KEY,
				expectedAudience: "test",
				expectedRevision: 4,
			},
		});
		await act(async () => finish(job("queued")));
		await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false));
		expect(
			client.getQueryData<BulletinTelegramState>(["bulletin-telegram", DATE])
				?.job?.status,
		).toBe("queued");
		expect(client.getQueryData(["bulletin-email", DATE])).toBeUndefined();
	});

	it("requires confirmation and an explicit mode save before public posting", async () => {
		view();
		await loaded();
		selectReal();
		expect(saveMode()).toBeDisabled();
		expect(send()).toBeDisabled();
		expect(mocks.audience).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("checkbox", { name: /אני מאשר מעבר לפרסום/ }),
		);
		fireEvent.click(saveMode());
		await waitFor(() =>
			expect(mocks.audience).toHaveBeenCalledExactlyOnceWith({
				data: { audience: "real", expectedRevision: 4, confirmReal: true },
			}),
		);
		const publish = await screen.findByRole("button", {
			name: "פרסום העלון בערוץ הציבורי",
		});
		await waitFor(() => expect(publish).toBeEnabled());
		expect(mocks.queue).not.toHaveBeenCalled();
		fireEvent.click(publish);
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

	it("keeps public activation disabled when target verification is unavailable", async () => {
		serverState.readiness.canUseReal = false;
		view();
		await loaded();
		expect(
			screen.getByRole("option", { name: "הערוץ הציבורי" }),
		).toBeDisabled();
		selectReal();
		fireEvent.click(
			screen.getByRole("checkbox", { name: /אני מאשר מעבר לפרסום/ }),
		);
		expect(saveMode()).toBeDisabled();
		fireEvent.click(saveMode());
		expect(mocks.audience).not.toHaveBeenCalled();
	});

	it("does not change the persisted audience or send after a failed mode change", async () => {
		mocks.audience.mockRejectedValue(new Error("revision changed"));
		view();
		await loaded();
		selectReal();
		fireEvent.click(
			screen.getByRole("checkbox", { name: /אני מאשר מעבר לפרסום/ }),
		);
		fireEvent.click(saveMode());
		await screen.findByText(/שינוי יעד הטלגרם לא נשמר/);
		expect(screen.getByText("מצב ניסיון - היעד הפרטי בלבד")).toBeVisible();
		expect(send()).toBeDisabled();
		expect(mocks.queue).not.toHaveBeenCalled();
	});

	it("refreshes stale settings without replaying a private click into the public audience", async () => {
		mocks.queue.mockImplementationOnce(() => {
			serverState = {
				...serverState,
				settings: { audience: "real", revision: 9 },
			};
			return Promise.reject(new Error("stale revision"));
		});
		view();
		await loaded();
		fireEvent.click(send());
		await screen.findByText("מצב פרסום בערוץ הציבורי");
		expect(mocks.queue).toHaveBeenCalledExactlyOnceWith({
			data: {
				date: DATE,
				requestKey: KEY,
				expectedAudience: "test",
				expectedRevision: 4,
			},
		});
		expect(mocks.audience).not.toHaveBeenCalled();
	});

	it("reuses a request UUID after a lost enqueue response and never retries automatically", async () => {
		mocks.queue.mockRejectedValue(new Error("lost response"));
		view();
		await loaded();
		fireEvent.click(send());
		await screen.findByText(/לא התקבלה תשובת שליחה תקינה/);
		await waitFor(() => expect(send()).toBeEnabled());
		expect(mocks.queue).toHaveBeenCalledTimes(1);
		fireEvent.click(send());
		await waitFor(() => expect(mocks.queue).toHaveBeenCalledTimes(2));
		expect(
			mocks.queue.mock.calls.map(([call]) => call.data.requestKey),
		).toEqual([KEY, KEY]);
		expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
	});

	it.each(["queued", "sending", "uncertain"] as const)(
		"blocks repeat sends and mode changes for %s work",
		async (status) => {
			serverState.job = job(status);
			view();
			await loaded();
			expect(send()).toBeDisabled();
			expect(screen.getByLabelText("יעד השליחה בטלגרם")).toBeDisabled();
			expect(
				screen.queryByRole("button", { name: "ניסיון טלגרם חדש" }),
			).not.toBeInTheDocument();
			if (status === "uncertain")
				expect(screen.getByText(/שליחה חוזרת חסומה/)).toBeVisible();
		},
	);

	it.each(["sent", "failed", "suppressed"] as const)(
		"requires explicit new test after terminal %s",
		async (status) => {
			serverState.job = job(status);
			vi.mocked(crypto.randomUUID).mockReturnValue(NEXT_KEY);
			view();
			await loaded();
			expect(send()).toBeDisabled();
			fireEvent.click(screen.getByRole("button", { name: "ניסיון טלגרם חדש" }));
			expect(mocks.queue).not.toHaveBeenCalled();
			expect(send()).toBeEnabled();
			fireEvent.click(send());
			await waitFor(() =>
				expect(mocks.queue).toHaveBeenCalledWith({
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

	it("never offers another public post after a sent production job", async () => {
		serverState.settings.audience = "real";
		serverState.job = job("sent", { audience: "real" });
		view();
		await loaded();
		expect(
			screen.getByRole("button", { name: "פרסום העלון בערוץ הציבורי" }),
		).toBeDisabled();
		expect(
			screen.queryByRole("button", { name: "ניסיון טלגרם חדש" }),
		).not.toBeInTheDocument();
		expect(screen.getByText(/אינו אישור קריאה/)).toBeVisible();
	});

	it("keeps late mutation results on the original date and clears date-specific errors", async () => {
		let finish: (value: TelegramJobSummary) => void = () => {};
		mocks.queue.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		const { client, rerender } = view();
		await loaded();
		fireEvent.click(send());
		await waitFor(() => expect(mocks.queue).toHaveBeenCalledOnce());
		rerender(NEXT_DATE);
		await waitFor(() =>
			expect(mocks.read).toHaveBeenCalledWith({ data: NEXT_DATE }),
		);
		await act(async () => finish(job("queued")));
		await waitFor(() =>
			expect(
				client.getQueryData<BulletinTelegramState>(["bulletin-telegram", DATE])
					?.job?.date,
			).toBe(DATE),
		);
		expect(
			client.getQueryData<BulletinTelegramState>([
				"bulletin-telegram",
				NEXT_DATE,
			])?.job,
		).toBeNull();
		expect(
			screen.queryByText(/ניסיון בטלגרם: ממתין בתור/),
		).not.toBeInTheDocument();
	});

	it("shows generic read errors without exposing provider details", async () => {
		mocks.read.mockRejectedValue(new Error("private-provider-detail"));
		view();
		await screen.findByText("לא ניתן לטעון את מצב הטלגרם כעת.");
		expect(
			screen.queryByText(/private-provider-detail/),
		).not.toBeInTheDocument();
		expect(send()).toBeDisabled();
	});

	it("clears old send feedback on a date change and creates a separate attempt key", async () => {
		mocks.queue.mockRejectedValue(new Error("lost response"));
		vi.mocked(crypto.randomUUID)
			.mockReturnValueOnce(KEY)
			.mockReturnValueOnce(NEXT_KEY);
		const { rerender } = view();
		await loaded();
		fireEvent.click(send());
		await screen.findByText(/לא התקבלה תשובת שליחה תקינה/);
		rerender(NEXT_DATE);
		await waitFor(() => expect(send()).toBeEnabled());
		expect(
			screen.queryByText(/לא התקבלה תשובת שליחה תקינה/),
		).not.toBeInTheDocument();
		fireEvent.click(send());
		await waitFor(() => expect(mocks.queue).toHaveBeenCalledTimes(2));
		expect(
			mocks.queue.mock.calls.map(([call]) => [
				call.data.date,
				call.data.requestKey,
			]),
		).toEqual([
			[DATE, KEY],
			[NEXT_DATE, NEXT_KEY],
		]);
	});

	it("polls read-only active state and stops once the private post is terminal", async () => {
		serverState.job = job("queued");
		vi.useFakeTimers();
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, staleTime: Infinity } },
		});
		client.setQueryData(["bulletin-telegram", DATE], serverState);
		render(
			<QueryClientProvider client={client}>
				<BulletinTelegramControls date={DATE} />
			</QueryClientProvider>,
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5000);
		});
		expect(mocks.read).toHaveBeenCalledTimes(1);
		serverState = { ...serverState, job: job("sent") };
		await act(async () => {
			await client.invalidateQueries({ queryKey: ["bulletin-telegram", DATE] });
			await vi.advanceTimersByTimeAsync(1);
		});
		const reads = mocks.read.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10000);
		});
		expect(mocks.read).toHaveBeenCalledTimes(reads);
		expect(mocks.queue).not.toHaveBeenCalled();
		expect(client.getQueryState(["daily-bulletin", DATE])).toBeUndefined();
	});

	it("recovers a failed settings read by explicit refresh without sending", async () => {
		mocks.read.mockRejectedValueOnce(new Error("private read failure"));
		view();
		await screen.findByText("לא ניתן לטעון את מצב הטלגרם כעת.");
		expect(send()).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "רענון מצב הטלגרם" }));
		await loaded();
		await waitFor(() => expect(send()).toBeEnabled());
		expect(mocks.read).toHaveBeenCalledTimes(2);
		expect(mocks.queue).not.toHaveBeenCalled();
		expect(mocks.audience).not.toHaveBeenCalled();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});
	it("shows the pending audience change and updates all cached dates without moving their jobs", async () => {
		const pending = deferred<{ audience: "real"; revision: number }>();
		mocks.audience.mockReturnValueOnce(pending.promise);
		const { client } = view();
		await loaded();
		const retained = job("sent", { audience: "real", date: NEXT_DATE });
		client.setQueryData(["bulletin-telegram", NEXT_DATE], {
			...ready(),
			settings: { audience: "real", revision: 3 },
			job: retained,
		});
		client.setQueryData(["bulletin-telegram", "2026-10-30"], {
			...ready(),
			job: job("sent", { date: "2026-10-30" }),
		});
		client
			.getQueryCache()
			.build(client, { queryKey: ["bulletin-telegram", "empty-cache"] });
		selectReal();
		fireEvent.click(
			screen.getByRole("checkbox", { name: /אני מאשר מעבר לפרסום/ }),
		);
		fireEvent.click(saveMode());
		const saving = await screen.findByRole("button", { name: "שומר יעד..." });
		expect(saving).toBeDisabled();
		const selector = screen.getByLabelText("יעד השליחה בטלגרם");
		expect(selector).toBeDisabled();
		fireEvent.change(selector, { target: { value: "test" } });
		expect(mocks.audience).toHaveBeenCalledOnce();
		serverState = {
			...serverState,
			settings: { audience: "real", revision: 5 },
			job: null,
		};
		await act(async () => pending.resolve({ audience: "real", revision: 5 }));
		await screen.findByText("מצב פרסום בערוץ הציבורי");
		expect(
			client.getQueryData<BulletinTelegramState>([
				"bulletin-telegram",
				NEXT_DATE,
			]),
		).toMatchObject({
			settings: { audience: "real", revision: 5 },
			job: retained,
		});
		expect(
			client.getQueryData<BulletinTelegramState>([
				"bulletin-telegram",
				"2026-10-30",
			]),
		).toMatchObject({
			settings: { audience: "real", revision: 5 },
			job: null,
		});
		expect(
			client.getQueryData(["bulletin-telegram", "empty-cache"]),
		).toBeUndefined();
		expect(mocks.queue).not.toHaveBeenCalled();
	});
	it("does not recreate an expired date cache from a late enqueue response", async () => {
		const pending = deferred<TelegramJobSummary>();
		mocks.queue.mockReturnValueOnce(pending.promise);
		const { client, rerender } = view();
		await loaded();
		fireEvent.click(send());
		await waitFor(() => expect(mocks.queue).toHaveBeenCalledOnce());
		rerender(NEXT_DATE);
		await waitFor(() =>
			expect(mocks.read).toHaveBeenCalledWith({ data: NEXT_DATE }),
		);
		await act(async () =>
			client.removeQueries({
				queryKey: ["bulletin-telegram", DATE],
				exact: true,
			}),
		);
		await act(async () => pending.resolve(job("queued")));
		expect(client.getQueryData(["bulletin-telegram", DATE])).toBeUndefined();
		expect(
			client.getQueryData<BulletinTelegramState>([
				"bulletin-telegram",
				NEXT_DATE,
			])?.job,
		).toBeNull();
		expect(
			screen.queryByText(/ניסיון בטלגרם: ממתין בתור/),
		).not.toBeInTheDocument();
		expect(mocks.queue).toHaveBeenCalledOnce();
	});
	it("shows the saved job explanation while a failed attempt waits for explicit operator action", async () => {
		serverState.job = job("failed", { error: "יש לבדוק את מצב הפרסום" });
		view();
		await loaded();
		expect(screen.getByText("יש לבדוק את מצב הפרסום")).toBeVisible();
		expect(send()).toBeDisabled();
		expect(mocks.queue).not.toHaveBeenCalled();
	});
	it("locks Telegram controls while another bulletin mutation is pending", async () => {
		view(DATE, true);
		await loaded();
		expect(send()).toBeDisabled();
		expect(screen.getByLabelText("יעד השליחה בטלגרם")).toBeDisabled();
	});
});
