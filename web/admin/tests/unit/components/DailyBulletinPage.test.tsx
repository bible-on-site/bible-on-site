import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BulletinEmailState, EmailJobSummary } from "~/lib/bulletin-email";
import type { PreparedBulletin } from "~/lib/daily-bulletin";

const mocks = vi.hoisted(() => ({
	read: vi.fn(),
	prepare: vi.fn(),
	emailRead: vi.fn(),
	emailSend: vi.fn(),
	audience: vi.fn(),
	telegramRead: vi.fn(),
	telegramQueue: vi.fn(),
	telegramAudience: vi.fn(),
}));
vi.mock("~/server/daily-bulletins", () => ({
	getDailyBulletin: mocks.read,
	prepareDailyBulletin: mocks.prepare,
}));
vi.mock("~/server/bulletin-email", () => ({
	getDailyBulletinEmail: mocks.emailRead,
	queueDailyBulletinEmail: mocks.emailSend,
	setDailyBulletinEmailAudience: mocks.audience,
}));
vi.mock("~/server/bulletin-telegram", () => ({
	getDailyBulletinTelegram: mocks.telegramRead,
	queueDailyBulletinTelegram: mocks.telegramQueue,
	setDailyBulletinTelegramAudience: mocks.telegramAudience,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => (
		<a href="/articles/perek/1">{children}</a>
	),
}));

import { DailyBulletinPage } from "~/components/DailyBulletinPage";

const FIRST_KEY = "11111111-1111-4111-8111-111111111111";
const NEXT_KEY = "22222222-2222-4222-8222-222222222222";
const saved: PreparedBulletin = {
	input: {
		date: "2026-10-08",
		hebrewDate: "כז תשרי תשפז",
		perekId: 1,
		article: { id: 7, title: "מאמר", author: "מחבר", html: "<p>תוכן</p>" },
		dedications: [],
	},
	subject: "עלון",
	source: "בראשית א",
	emailHtml: "<h1>תוכן העלון</h1>",
	pdfBase64: "JVBERi0=",
	filename: "bulletin.pdf",
	delivery: [
		{ channel: "email", status: "pending" },
		{ channel: "telegram", status: "sent" },
		{ channel: "whatsapp", status: "uncertain" },
	],
};
function job(
	status: EmailJobSummary["status"] = "queued",
	overrides: Partial<EmailJobSummary> = {},
): EmailJobSummary {
	return {
		id: "job-1",
		date: saved.input.date,
		audience: "test",
		status,
		counts: { [status]: 2 },
		createdAt: "2026-10-08T12:00:00Z",
		...overrides,
	};
}
function configured(): BulletinEmailState {
	return {
		settings: { audience: "test", revision: 4 },
		readiness: {
			configured: true,
			canSend: true,
			canUseReal: true,
			blockers: [],
		},
		testRecipients: ["first@example.com", "second@example.com"],
		realRecipients: 52,
		unverifiedRecipients: 22,
		job: null,
	};
}
let serverState: BulletinEmailState;
function panel() {
	return within(screen.getByRole("region", { name: 'שליחת העלון בדוא"ל' }));
}
function send() {
	return panel().getByRole("button", { name: "שליחת ניסיון בלבד" });
}
function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<DailyBulletinPage />
		</QueryClientProvider>,
	);
	return client;
}
async function loaded() {
	await screen.findByText("first@example.com");
}
function requestReal() {
	fireEvent.change(screen.getByLabelText("קהל השליחה"), {
		target: { value: "real" },
	});
}
function confirmReal() {
	fireEvent.click(
		screen.getByRole("checkbox", { name: /אני מאשר מעבר לשליחה/ }),
	);
}

describe("daily bulletin preview and SES delivery", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
		vi.spyOn(crypto, "randomUUID").mockReturnValue(FIRST_KEY);
		serverState = configured();
		mocks.read.mockReset().mockResolvedValue(saved);
		mocks.prepare.mockReset().mockResolvedValue(saved);
		mocks.emailRead
			.mockReset()
			.mockImplementation(() => Promise.resolve(serverState));
		mocks.emailSend.mockReset().mockImplementation(({ data }) => {
			serverState = {
				...serverState,
				job: job("queued", { date: data.date, audience: data.audience }),
			};
			return Promise.resolve(serverState.job);
		});
		mocks.audience.mockReset().mockImplementation(({ data }) => {
			const settings = { audience: data.audience, revision: data.revision + 1 };
			serverState = { ...serverState, settings };
			return Promise.resolve(settings);
		});
		mocks.telegramRead.mockReset().mockResolvedValue({
			settings: { audience: "test", revision: 0 },
			readiness: {
				configured: false,
				canSend: false,
				canUseReal: false,
				blockers: ["שירות הטלגרם טרם הוגדר"],
			},
			testTarget: null,
			realTarget: null,
			job: null,
		});
		mocks.telegramQueue.mockReset();
		mocks.telegramAudience.mockReset();
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("prepares once and preserves chapter, PDF, email and channel previews", async () => {
		mocks.read.mockResolvedValue(null);
		renderPage();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "הכנת עלון" })).toBeEnabled(),
		);
		expect(mocks.emailRead).not.toHaveBeenCalled();
		expect(mocks.telegramRead).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "הכנת עלון" }));
		expect(await screen.findByText("מאמר: מאמר / מחבר")).toBeInTheDocument();
		expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith({
			data: saved.input.date,
		});
		expect(screen.getByRole("button", { name: "העלון הוכן" })).toBeDisabled();
		expect(screen.getByRole("link", { name: "הורדת PDF" })).toHaveAttribute(
			"download",
			"bulletin.pdf",
		);
		expect(screen.getByTitle("תצוגת העלון היומי")).toHaveAttribute(
			"sandbox",
			"",
		);
		expect(screen.getByTitle("תצוגת העלון היומי")).toHaveAttribute(
			"srcdoc",
			saved.emailHtml,
		);
		expect(screen.getByText('דוא"ל: טרם נשלח')).toBeInTheDocument();
		expect(screen.getByText("טלגרם: נשלח")).toBeInTheDocument();
		expect(screen.getByText("ווטסאפ: נדרשת בדיקה")).toBeInTheDocument();
	});
	it("locks the bulletin date and email actions while a private Telegram enqueue is pending", async () => {
		let finish: (value: unknown) => void = () => {};
		mocks.telegramRead.mockResolvedValue({
			settings: { audience: "test", revision: 2 },
			readiness: {
				configured: true,
				canSend: true,
				canUseReal: false,
				blockers: [],
			},
			testTarget: { title: "ערוץ ניסיון מקומי", username: null },
			realTarget: null,
			job: null,
		});
		mocks.telegramQueue.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		renderPage();
		await loaded();
		await screen.findByText("ערוץ ניסיון מקומי");
		fireEvent.click(
			screen.getByRole("button", { name: "שליחת ניסיון בטלגרם" }),
		);
		await waitFor(() =>
			expect(screen.getByLabelText("תאריך העלון")).toBeDisabled(),
		);
		expect(send()).toBeDisabled();
		expect(screen.getByLabelText("קהל השליחה")).toBeDisabled();
		fireEvent.change(screen.getByLabelText("תאריך העלון"), {
			target: { value: "2026-10-09" },
		});
		expect(screen.getByLabelText("תאריך העלון")).toHaveValue(saved.input.date);
		await act(async () =>
			finish({
				id: "telegram-job",
				date: saved.input.date,
				audience: "test",
				status: "queued",
				createdAt: "2026-10-08T12:00:00Z",
				sentAt: null,
				error: null,
			}),
		);
		await waitFor(() =>
			expect(screen.getByLabelText("תאריך העלון")).toBeEnabled(),
		);
		expect(mocks.emailSend).not.toHaveBeenCalled();
		expect(mocks.audience).not.toHaveBeenCalled();
		expect(screen.getByText('דוא"ל: טרם נשלח')).toBeVisible();
	});
	it("reads a saved bulletin without preparing and handles a missing article", async () => {
		mocks.read.mockResolvedValue({
			...saved,
			input: { ...saved.input, article: null },
		});
		renderPage();
		expect(
			await screen.findByText("לא נמצא מאמר מאושר לפרק זה."),
		).toBeInTheDocument();
		expect(mocks.prepare).not.toHaveBeenCalled();
	});
	it("shows read and preparation failures and clears errors on a date change", async () => {
		mocks.read
			.mockRejectedValueOnce(new Error("קריאת העלון נכשלה"))
			.mockResolvedValue(null);
		mocks.prepare.mockRejectedValue(new Error("יצירת העלון נכשלה"));
		renderPage();
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"קריאת העלון נכשלה",
		);
		fireEvent.change(screen.getByLabelText("תאריך העלון"), {
			target: { value: "2026-10-09" },
		});
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "הכנת עלון" })).toBeEnabled(),
		);
		fireEvent.click(screen.getByRole("button", { name: "הכנת עלון" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"יצירת העלון נכשלה",
		);
		fireEvent.change(screen.getByLabelText("תאריך העלון"), {
			target: { value: "2026-10-10" },
		});
		await waitFor(() =>
			expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
		);
	});
	it("locks preparation controls while preparing", async () => {
		mocks.read.mockResolvedValue(null);
		mocks.prepare.mockReturnValue(new Promise(() => {}));
		renderPage();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "הכנת עלון" })).toBeEnabled(),
		);
		fireEvent.click(screen.getByRole("button", { name: "הכנת עלון" }));
		expect(
			await screen.findByRole("button", { name: "מכין עלון..." }),
		).toBeDisabled();
		expect(screen.getByLabelText("תאריך העלון")).toBeDisabled();
	});
	it("loads persisted TEST without changing it and displays the configured audiences", async () => {
		renderPage();
		await loaded();
		expect(
			panel().getByText("מצב ניסיון - שליחה לנמעני הניסיון בלבד"),
		).toBeInTheDocument();
		expect(screen.getByLabelText("קהל השליחה")).toHaveValue("test");
		expect(panel().getByText("second@example.com")).toBeInTheDocument();
		expect(
			panel().getByText("מנויים מאושרים: 52. כתובות שטרם אומתו: 22."),
		).toBeInTheDocument();
		expect(mocks.audience).not.toHaveBeenCalled();
		expect(mocks.emailSend).not.toHaveBeenCalled();
	});
	it("blocks sending while settings load and when their read fails", async () => {
		let rejectRead: (error: Error) => void = () => {};
		mocks.emailRead.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectRead = reject;
			}),
		);
		renderPage();
		expect(await screen.findByText("טוען הגדרות שליחה...")).toBeInTheDocument();
		expect(send()).toBeDisabled();
		rejectRead(new Error("הגדרות השליחה אינן זמינות"));
		expect(await panel().findByRole("alert")).toHaveTextContent(
			"הגדרות השליחה אינן זמינות",
		);
		expect(send()).toBeDisabled();
		expect(mocks.emailRead).toHaveBeenCalledTimes(1);
	});
	it("displays readiness blockers and prevents unconfigured sends", async () => {
		serverState = {
			...serverState,
			readiness: {
				configured: false,
				canSend: false,
				canUseReal: false,
				blockers: ["יש להשלים אימות כתובות ניסיון"],
			},
		};
		renderPage();
		await loaded();
		expect(panel().getByRole("alert")).toHaveTextContent(
			"יש להשלים אימות כתובות ניסיון",
		);
		expect(send()).toBeDisabled();
		fireEvent.click(send());
		expect(mocks.emailSend).not.toHaveBeenCalled();
	});
	it("queues the captured date, audience, revision and request UUID without changing production status", async () => {
		const client = renderPage();
		await loaded();
		fireEvent.click(send());
		await panel().findByText("ניסיון: ממתין בתור");
		expect(mocks.emailSend).toHaveBeenCalledExactlyOnceWith({
			data: {
				date: saved.input.date,
				audience: "test",
				revision: 4,
				requestKey: FIRST_KEY,
			},
		});
		expect(send()).toBeDisabled();
		expect(
			client.getQueryData<BulletinEmailState>([
				"bulletin-email",
				saved.input.date,
			])?.job?.status,
		).toBe("queued");
		expect(client.getQueryData(["daily-bulletin", saved.input.date])).toEqual(
			saved,
		);
		expect(screen.getByText('דוא"ל: טרם נשלח')).toBeInTheDocument();
	});
	it("locks date and mode while enqueueing and caches the result under its original date", async () => {
		let resolveSend: (result: EmailJobSummary) => void = () => {};
		mocks.emailSend.mockReturnValue(
			new Promise((resolve) => {
				resolveSend = resolve;
			}),
		);
		const client = renderPage();
		await loaded();
		fireEvent.click(send());
		expect(
			await panel().findByRole("button", { name: "מוסיף לתור..." }),
		).toBeDisabled();
		expect(screen.getByLabelText("תאריך העלון")).toBeDisabled();
		expect(screen.getByLabelText("קהל השליחה")).toBeDisabled();
		fireEvent.change(screen.getByLabelText("תאריך העלון"), {
			target: { value: "2026-10-09" },
		});
		requestReal();
		expect(screen.getByLabelText("תאריך העלון")).toHaveValue(saved.input.date);
		expect(screen.getByLabelText("קהל השליחה")).toHaveValue("test");
		resolveSend(job());
		await panel().findByText("ניסיון: ממתין בתור");
		expect(
			client.getQueryData<BulletinEmailState>([
				"bulletin-email",
				saved.input.date,
			])?.job?.id,
		).toBe("job-1");
		expect(
			client.getQueryData(["bulletin-email", "2026-10-09"]),
		).toBeUndefined();
	});
	it("requires explicit confirmation and save before switching to real recipients", async () => {
		renderPage();
		await loaded();
		requestReal();
		const saveMode = screen.getByRole("button", { name: "שמירת קהל השליחה" });
		expect(saveMode).toBeDisabled();
		expect(send()).toBeDisabled();
		fireEvent.click(saveMode);
		expect(mocks.audience).not.toHaveBeenCalled();
		confirmReal();
		fireEvent.click(saveMode);
		await panel().findByText("מצב מנויים - שליחה לרשימת המנויים");
		expect(mocks.audience).toHaveBeenCalledExactlyOnceWith({
			data: { audience: "real", revision: 4, confirmReal: true },
		});
		expect(mocks.emailSend).not.toHaveBeenCalled();
		const realSend = panel().getByRole("button", {
			name: "שליחת העלון למנויים",
		});
		await waitFor(() => expect(realSend).toBeEnabled());
		fireEvent.click(realSend);
		await waitFor(() =>
			expect(mocks.emailSend).toHaveBeenCalledExactlyOnceWith({
				data: {
					date: saved.input.date,
					audience: "real",
					revision: 5,
					requestKey: FIRST_KEY,
				},
			}),
		);
	});
	it.each([
		{ canUseReal: false, recipients: 52 },
		{ canUseReal: true, recipients: 0 },
	])(
		"disables real mode without readiness or confirmed consent: %j",
		async ({ canUseReal, recipients }) => {
			serverState = {
				...serverState,
				realRecipients: recipients,
				readiness: { ...serverState.readiness, canUseReal },
			};
			renderPage();
			await loaded();
			expect(
				screen.getByRole("option", { name: "רשימת המנויים" }),
			).toBeDisabled();
			requestReal();
			confirmReal();
			expect(
				screen.getByRole("button", { name: "שמירת קהל השליחה" }),
			).toBeDisabled();
			expect(mocks.audience).not.toHaveBeenCalled();
		},
	);
	it("leaves the persisted mode unchanged after an audience update failure", async () => {
		mocks.audience.mockRejectedValue(
			new Error("מצב השליחה השתנה. רעננו את המסך."),
		);
		renderPage();
		await loaded();
		requestReal();
		confirmReal();
		fireEvent.click(screen.getByRole("button", { name: "שמירת קהל השליחה" }));
		expect(await panel().findByRole("alert")).toHaveTextContent(
			"מצב השליחה השתנה",
		);
		expect(
			panel().getByText("מצב ניסיון - שליחה לנמעני הניסיון בלבד"),
		).toBeInTheDocument();
		expect(send()).toBeDisabled();
		expect(mocks.emailSend).not.toHaveBeenCalled();
	});
	it("locks the date and audience while a mode change is pending", async () => {
		mocks.audience.mockReturnValue(new Promise(() => {}));
		renderPage();
		await loaded();
		requestReal();
		confirmReal();
		fireEvent.click(screen.getByRole("button", { name: "שמירת קהל השליחה" }));
		expect(
			await screen.findByRole("button", { name: "שומר קהל..." }),
		).toBeDisabled();
		expect(screen.getByLabelText("תאריך העלון")).toBeDisabled();
		expect(screen.getByLabelText("קהל השליחה")).toBeDisabled();
		expect(send()).toBeDisabled();
	});
	it("respects an existing persisted real mode and never offers another completed real send", async () => {
		serverState = {
			...serverState,
			settings: { audience: "real", revision: 8 },
			job: job("delivered", { audience: "real" }),
		};
		renderPage();
		await loaded();
		expect(screen.getByLabelText("קהל השליחה")).toHaveValue("real");
		expect(
			panel().getByRole("button", { name: "שליחת העלון למנויים" }),
		).toBeDisabled();
		expect(
			panel().queryByRole("button", { name: "ניסיון חדש" }),
		).not.toBeInTheDocument();
		expect(mocks.audience).not.toHaveBeenCalled();
		expect(mocks.emailSend).not.toHaveBeenCalled();
	});
	it("never upgrades a stale test request to real mode and reuses its UUID after rejection", async () => {
		mocks.emailSend.mockRejectedValue(new Error("מצב השליחה השתנה"));
		renderPage();
		await loaded();
		fireEvent.click(send());
		expect(await panel().findByRole("alert")).toHaveTextContent(
			"מצב השליחה השתנה",
		);
		await waitFor(() => expect(send()).toBeEnabled());
		fireEvent.click(send());
		await waitFor(() => expect(mocks.emailSend).toHaveBeenCalledTimes(2));
		for (const [request] of mocks.emailSend.mock.calls)
			expect(request.data).toEqual({
				date: saved.input.date,
				audience: "test",
				revision: 4,
				requestKey: FIRST_KEY,
			});
		expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
	});
	it.each(["queued", "sending", "accepted", "uncertain"] as const)(
		"blocks repeating %s and offers no new test",
		async (status) => {
			serverState = { ...serverState, job: job(status) };
			renderPage();
			await loaded();
			expect(send()).toBeDisabled();
			expect(
				panel().queryByRole("button", { name: "ניסיון חדש" }),
			).not.toBeInTheDocument();
			fireEvent.click(send());
			expect(mocks.emailSend).not.toHaveBeenCalled();
			if (status === "accepted") {
				expect(panel().getByText("ניסיון: התקבל ב-SES")).toBeInTheDocument();
				expect(
					panel().queryByText("ניסיון: נמסר לשרת הדואר"),
				).not.toBeInTheDocument();
			}
			if (status === "uncertain")
				expect(
					panel().getByText(/יש לבדוק את יומן השליחה ואירועי SES/),
				).toBeInTheDocument();
		},
	);
	it.each(["delivered", "failed", "suppressed"] as const)(
		"requires a deliberate new attempt after terminal %s test",
		async (status) => {
			serverState = { ...serverState, job: job(status) };
			vi.mocked(crypto.randomUUID).mockReturnValue(NEXT_KEY);
			renderPage();
			await loaded();
			expect(send()).toBeDisabled();
			fireEvent.click(panel().getByRole("button", { name: "ניסיון חדש" }));
			expect(mocks.emailSend).not.toHaveBeenCalled();
			expect(send()).toBeEnabled();
			fireEvent.click(send());
			await waitFor(() => expect(mocks.emailSend).toHaveBeenCalledTimes(1));
			expect(mocks.emailSend.mock.calls[0][0].data.requestKey).toBe(NEXT_KEY);
		},
	);
	it("refreshes a rejected send once and blocks repeats after an uncertain outcome", async () => {
		mocks.emailRead
			.mockResolvedValueOnce(serverState)
			.mockResolvedValue({ ...serverState, job: job("uncertain") });
		mocks.emailSend.mockRejectedValue(new Error("לא התקבל אישור"));
		renderPage();
		await loaded();
		fireEvent.click(send());
		await panel().findByText(/יש לבדוק את יומן השליחה ואירועי SES/);
		expect(send()).toBeDisabled();
		expect(mocks.emailSend).toHaveBeenCalledTimes(1);
		expect(mocks.emailRead).toHaveBeenCalledTimes(2);
	});
	it("keeps date caches independent and clears an old send error on a date change", async () => {
		mocks.read.mockImplementation(({ data }) =>
			Promise.resolve({ ...saved, input: { ...saved.input, date: data } }),
		);
		mocks.emailSend.mockRejectedValue(new Error("הוספה לתור נכשלה"));
		const client = renderPage();
		await loaded();
		fireEvent.click(send());
		await panel().findByRole("alert");
		await waitFor(() =>
			expect(screen.getByLabelText("תאריך העלון")).toBeEnabled(),
		);
		fireEvent.change(screen.getByLabelText("תאריך העלון"), {
			target: { value: "2026-10-09" },
		});
		await waitFor(() => expect(send()).toBeEnabled());
		expect(panel().queryByRole("alert")).not.toBeInTheDocument();
		expect(mocks.emailRead).toHaveBeenLastCalledWith({ data: "2026-10-09" });
		expect(
			client.getQueryData<BulletinEmailState>([
				"bulletin-email",
				saved.input.date,
			])?.job,
		).toBeNull();
	});
	it("polls read-only state only while active and stops after delivery", async () => {
		serverState = { ...serverState, job: job("accepted") };
		vi.useFakeTimers();
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, staleTime: Infinity } },
		});
		client.setQueryData(["daily-bulletin", saved.input.date], saved);
		client.setQueryData(["bulletin-email", saved.input.date], serverState);
		render(
			<QueryClientProvider client={client}>
				<DailyBulletinPage />
			</QueryClientProvider>,
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5000);
		});
		expect(mocks.emailRead).toHaveBeenCalledTimes(1);
		serverState = { ...serverState, job: job("delivered") };
		await act(async () => {
			await client.invalidateQueries({
				queryKey: ["bulletin-email", saved.input.date],
			});
			await vi.advanceTimersByTimeAsync(1);
		});
		const calls = mocks.emailRead.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10000);
		});
		expect(mocks.emailRead).toHaveBeenCalledTimes(calls);
		expect(mocks.emailSend).not.toHaveBeenCalled();
	});
});
