import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreparedBulletin } from "~/lib/daily-bulletin";

const mocks = vi.hoisted(() => ({ read: vi.fn(), prepare: vi.fn() }));
vi.mock("~/server/daily-bulletins", () => ({
	getDailyBulletin: mocks.read,
	prepareDailyBulletin: mocks.prepare,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => (
		<a href="/articles/perek/1">{children}</a>
	),
}));

import { DailyBulletinPage } from "~/components/DailyBulletinPage";

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
function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<DailyBulletinPage />
		</QueryClientProvider>,
	);
}
describe("daily bulletin preview", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
		mocks.read.mockReset().mockResolvedValue(null);
		mocks.prepare.mockReset().mockResolvedValue(saved);
	});
		afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});
	it("prepares the selected date once and shows its saved email, PDF, and delivery status", async () => {
		renderPage();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "הכנת עלון" })).toBeEnabled(),
		);
		fireEvent.change(screen.getByLabelText("תאריך העלון"), {
			target: { value: saved.input.date },
		});
		fireEvent.click(screen.getByRole("button", { name: "הכנת עלון" }));
		expect(await screen.findByText("מאמר: מאמר / מחבר")).toBeInTheDocument();
		expect(mocks.prepare).toHaveBeenCalledWith({ data: "2026-10-08" });
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
	it("reads an existing bulletin without preparing it again, including the no-article case", async () => {
		mocks.read.mockResolvedValue({
			...saved,
			input: { ...saved.input, article: null },
		});
		renderPage();
		expect(
			await screen.findByText("לא נמצא מאמר מאושר לפרק זה."),
		).toBeInTheDocument();
		expect(mocks.prepare).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "העלון הוכן" })).toBeDisabled();
	});
	it("shows preparation errors and clears them when selecting another date", async () => {
		mocks.prepare.mockRejectedValue(new Error("יצירת העלון נכשלה"));
		renderPage();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "הכנת עלון" })).toBeEnabled(),
		);
		fireEvent.click(screen.getByRole("button", { name: "הכנת עלון" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"יצירת העלון נכשלה",
		);
		fireEvent.change(screen.getByLabelText("תאריך העלון"), {
			target: { value: "2026-10-09" },
		});
		await waitFor(() =>
			expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
		);
		expect(mocks.read).toHaveBeenLastCalledWith({ data: "2026-10-09" });
	});
	it("keeps the date and submit button disabled while preparation runs", async () => {
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
});
