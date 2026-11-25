import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BulletinEmailEngagement } from "~/components/BulletinEmailEngagement";
import type { EmailEngagementPanel } from "~/lib/bulletin-email";

const mocks = vi.hoisted(() => ({ read: vi.fn(), confirm: vi.fn() }));
vi.mock("~/server/bulletin-email", () => ({
	getDailyBulletinEmailEngagement: mocks.read,
	confirmDailyBulletinInactivityUnsubscribe: mocks.confirm,
}));

function panel(
	overrides: Partial<EmailEngagementPanel> = {},
): EmailEngagementPanel {
	return {
		editions: [
			{
				jobId: "job-2",
				date: "2026-10-28",
				tracked: true,
				delivered: 50,
				opened: 25,
				clicked: 5,
			},
			{
				jobId: "job-1",
				date: "2026-10-27",
				tracked: false,
				delivered: 48,
				opened: 0,
				clicked: 0,
			},
		],
		inactive: [
			{
				id: 7,
				email: "silent@example.com",
				firstTrackedDelivery: "2025-10-28",
				trackedLastYear: 40,
			},
		],
		reviewEnabled: true,
		...overrides,
	};
}

let client: QueryClient;
function mount() {
	return render(
		<QueryClientProvider client={client}>
			<BulletinEmailEngagement />
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

describe("BulletinEmailEngagement", () => {
	it("shows per-edition tracked rates and distinguishes untracked history", async () => {
		mocks.read.mockResolvedValue(panel());
		mount();
		expect(await screen.findByText("25 (50%)")).toBeDefined();
		expect(screen.getByText("5 (10%)")).toBeDefined();
		expect(screen.getByText("50")).toBeDefined();
		expect(
			screen.getByText(/אין נתוני פתיחות וקליקים עבור עלון זה/),
		).toBeDefined();
	});
	it("labels the statistics as tracked activity with its privacy caveats", async () => {
		mocks.read.mockResolvedValue(panel());
		mount();
		expect(
			await screen.findByText(/Apple Mail Privacy Protection/),
		).toBeDefined();
		expect(screen.getByText(/סורקי קישורים/)).toBeDefined();
	});
	it("explains the undeployed state instead of a measured zero", async () => {
		mocks.read.mockResolvedValue(null);
		mount();
		expect(
			await screen.findByText(/מדידת פתיחות וקליקים טרם הופעלה/),
		).toBeDefined();
	});
	it("shows a dash instead of a rate when nobody was delivered", async () => {
		mocks.read.mockResolvedValue(
			panel({
				editions: [
					{
						jobId: "job-0",
						date: "2026-10-28",
						tracked: true,
						delivered: 0,
						opened: 0,
						clicked: 0,
					},
				],
			}),
		);
		mount();
		expect(await screen.findAllByText("0 (-)")).toHaveLength(2);
	});
	it("surfaces a failed engagement read", async () => {
		mocks.read.mockRejectedValue(new Error("קריאה נכשלה"));
		mount();
		expect(await screen.findByRole("alert")).toHaveTextContent("קריאה נכשלה");
	});
	it("shows the empty-editions note when nothing was sent yet", async () => {
		mocks.read.mockResolvedValue(panel({ editions: [] }));
		mount();
		expect(await screen.findByText(/אין עדיין משלוחי מנויים/)).toBeDefined();
	});
	it("shows an empty review list when nobody qualifies", async () => {
		mocks.read.mockResolvedValue(panel({ inactive: [] }));
		mount();
		expect(
			await screen.findByText(/אין מנויים העומדים כרגע בתנאי ההסרה/),
		).toBeDefined();
		expect(screen.queryByRole("button", { name: "הסרה מהדיוור" })).toBeNull();
	});
	it("requires explicit confirmation before sending the unsubscribe", async () => {
		mocks.read.mockResolvedValue(panel());
		mocks.confirm.mockResolvedValue(undefined);
		const invalidate = vi.spyOn(client, "invalidateQueries");
		mount();
		const remove = await screen.findByRole("button", { name: "הסרה מהדיוור" });
		fireEvent.click(remove);
		fireEvent.click(
			await screen.findByRole("button", { name: "אישור הסרה מהדיוור" }),
		);
		await waitFor(() =>
			expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith({
				data: { subscriberId: 7 },
			}),
		);
		await waitFor(() => expect(invalidate).toHaveBeenCalled());
	});
	it("cancels the confirmation without calling the server", async () => {
		mocks.read.mockResolvedValue(panel());
		mount();
		fireEvent.click(
			await screen.findByRole("button", { name: "הסרה מהדיוור" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
		expect(mocks.confirm).not.toHaveBeenCalled();
	});
	it("surfaces a rejected confirmation without retrying", async () => {
		mocks.read.mockResolvedValue(panel());
		mocks.confirm.mockRejectedValue(new Error("נרשמה פעילות"));
		mount();
		fireEvent.click(
			await screen.findByRole("button", { name: "הסרה מהדיוור" }),
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "אישור הסרה מהדיוור" }),
		);
		expect(await screen.findByRole("alert")).toHaveTextContent("נרשמה פעילות");
		expect(mocks.confirm).toHaveBeenCalledTimes(1);
	});
	it("disables the confirmation and cancel buttons while a removal is pending", async () => {
		let resolveConfirm: (() => void) | undefined;
		mocks.read.mockResolvedValue(panel());
		mocks.confirm.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveConfirm = resolve;
				}),
		);
		mount();
		fireEvent.click(
			await screen.findByRole("button", { name: "הסרה מהדיוור" }),
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "אישור הסרה מהדיוור" }),
		);
		expect(
			await screen.findByRole("button", { name: "מסיר..." }),
		).toBeDisabled();
		expect(screen.getByRole("button", { name: "ביטול" })).toBeDisabled();
		resolveConfirm?.();
		await waitFor(() => expect(screen.queryByText("מסיר...")).toBeNull());
	});
	it("explains a paused review and keeps historical metrics visible", async () => {
		mocks.read.mockResolvedValue(panel({ reviewEnabled: false, inactive: [] }));
		mount();
		expect(await screen.findByText(/סקירת חוסר פעילות מושהית/)).toBeVisible();
		expect(screen.getByText("25 (50%)")).toBeVisible();
		expect(screen.queryByRole("button", { name: "הסרה מהדיוור" })).toBeNull();
	});
});
