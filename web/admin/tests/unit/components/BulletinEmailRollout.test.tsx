import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BulletinEmailRollout } from "~/components/BulletinEmailRollout";
import type { EmailRolloutSummary } from "~/lib/bulletin-rollout";

const mocks = vi.hoisted(() => ({ change: vi.fn() }));
vi.mock("~/server/bulletin-email", () => ({
	setDailyBulletinEmailRollout: mocks.change,
}));

function summary(
	overrides: Partial<EmailRolloutSummary> = {},
): EmailRolloutSummary {
	return {
		state: "running",
		cohort: "original",
		revision: 7,
		admitted: 1,
		remaining: 49,
		excluded: 2,
		admission: {
			localDate: "2026-11-15",
			status: "admitted",
			subscriberId: 5,
			lastError: null,
		},
		lastError: null,
		...overrides,
	};
}

let client: QueryClient;
function mount(rollout = summary(), job = null) {
	return render(
		<QueryClientProvider client={client}>
			<BulletinEmailRollout rollout={rollout} job={job} />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.resetAllMocks();
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
});
afterEach(cleanup);

describe("BulletinEmailRollout", () => {
	it("shows counts and today's reservation without any address", () => {
		mount();
		expect(
			screen.getByText("פעילה - מתווסף לכל היותר מנוי אחד בכל יום"),
		).toBeDefined();
		expect(screen.getByText(/צורפו: 1/)).toBeDefined();
		expect(screen.getByText(/נותרו ברשימה המקורית: 49/)).toBeDefined();
		expect(screen.getByText(/2026-11-15/)).toBeDefined();
		expect(screen.getByText(/הושלם/)).toBeDefined();
	});
	it.each([
		["disabled", ["enable"], ["pause", "resume", "disable"]],
		["running", ["pause", "disable"], ["enable", "resume"]],
		["paused", ["resume", "disable"], ["enable", "pause"]],
		["completed", ["disable"], ["enable", "pause", "resume"]],
	] as const)(
		"offers only valid transitions while %s",
		(state, offered, withheld) => {
			mount(summary({ state }));
			const buttons = screen
				.getAllByRole("button")
				.map((button) => button.textContent);
			const labels = {
				enable: "הפעלת ההדרגתיות",
				pause: "השהיית צירופים",
				resume: "חידוש צירופים",
				disable: "ביטול מלא",
			};
			for (const action of offered) expect(buttons).toContain(labels[action]);
			for (const action of withheld)
				expect(buttons).not.toContain(labels[action]);
		},
	);
	it("sends the revision-checked action and refreshes the bulletin query", async () => {
		mocks.change.mockResolvedValue({ state: "paused", revision: 8 });
		const invalidate = vi.spyOn(client, "invalidateQueries");
		mount();
		fireEvent.click(screen.getByRole("button", { name: "השהיית צירופים" }));
		await waitFor(() =>
			expect(mocks.change).toHaveBeenCalledExactlyOnceWith({
				data: { action: "pause", revision: 7 },
			}),
		);
		await waitFor(() => expect(invalidate).toHaveBeenCalled());
	});
	it("surfaces a rejected transition without retrying", async () => {
		mocks.change.mockRejectedValue(new Error("מצב ההפעלה השתנה"));
		mount();
		fireEvent.click(screen.getByRole("button", { name: "ביטול מלא" }));
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toContain(
				"מצב ההפעלה השתנה",
			),
		);
		expect(mocks.change).toHaveBeenCalledTimes(1);
	});
	it("shows the limited-cohort job when one exists for the date", () => {
		mount(summary(), {
			id: "job-1234",
			status: "sending",
		} as never);
		expect(screen.getByText(/משלוח מנויים הדרגתי להיום/)).toBeDefined();
		expect(screen.getByText(/בשליחה/)).toBeDefined();
	});
});
