import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BulletinJoinLinks } from "~/components/BulletinJoinLinks";
import type { JoinLinkState } from "~/lib/bulletin-join";

const mocks = vi.hoisted(() => ({
	read: vi.fn(),
	update: vi.fn(),
}));
vi.mock("~/server/bulletin-join", () => ({
	getBulletinJoinLinks: mocks.read,
	updateBulletinJoinLink: mocks.update,
}));

function link(overrides: Partial<JoinLinkState> = {}): JoinLinkState {
	return {
		channel: "telegram",
		enabled: true,
		destination: "https://t.me/alhaperek",
		revision: 3,
		updatedBy: "editor@example.com",
		updatedAt: "2026-10-27T10:00:00.000Z",
		...overrides,
	};
}

function view() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<BulletinJoinLinks />
		</QueryClientProvider>,
	);
	return client;
}

const whatsappLink = link({
	channel: "whatsapp",
	enabled: false,
	destination: null,
	revision: 0,
	updatedBy: null,
	updatedAt: null,
});

beforeEach(() => {
	mocks.read.mockReset().mockResolvedValue({
		links: [link(), whatsappLink],
		audit: [
			{
				id: 5,
				channel: "telegram" as const,
				enabled: true,
				destination: "https://t.me/alhaperek",
				revision: 3,
				changedBy: "editor@example.com",
				changedAt: "2026-10-27T10:00:00.000Z",
			},
		],
	});
	mocks.update.mockReset().mockResolvedValue(link({ revision: 4 }));
});

afterEach(cleanup);

describe("BulletinJoinLinks", () => {
	it("shows the stable public URLs and current destinations for both channels", async () => {
		view();
		expect((await screen.findAllByLabelText("יעד ההפניה"))[0]).toHaveValue(
			"https://t.me/alhaperek",
		);
		expect(
			screen.getByRole("link", {
				name: "http://localhost:3001/dailyBulletin/join/telegram",
			}),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", {
				name: "http://localhost:3001/dailyBulletin/join/whatsapp",
			}),
		).toBeInTheDocument();
		expect(screen.getByText("יומן שינויים אחרונים")).toBeInTheDocument();
	});

	it("keeps saving disabled until a field actually changes", async () => {
		view();
		const fieldset = (
			await screen.findByDisplayValue("https://t.me/alhaperek")
		).closest("fieldset") as HTMLElement;
		const save = screen.getAllByRole("button", { name: "שמירה" })[0];
		expect(save).toBeDisabled();
		fireEvent.click(within(fieldset).getByRole("checkbox"));
		expect(save).toBeEnabled();
	});

	it("requires a destination before an enabled channel can be saved", async () => {
		mocks.read.mockResolvedValue({ links: [whatsappLink], audit: [] });
		view();
		fireEvent.click(await screen.findByRole("checkbox"));
		const save = screen.getByRole("button", { name: "שמירה" });
		expect(save).toBeDisabled();
		fireEvent.change(screen.getByLabelText("יעד ההפניה"), {
			target: { value: "https://chat.whatsapp.com/AbCdEfGh1234567890" },
		});
		expect(save).toBeEnabled();
	});

	it("sends the seen revision with the edited values", async () => {
		view();
		const input = await screen.findByDisplayValue("https://t.me/alhaperek");
		fireEvent.change(input, { target: { value: "https://t.me/newchannel" } });
		fireEvent.click(screen.getAllByRole("button", { name: "שמירה" })[0]);
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith({
				data: {
					channel: "telegram",
					enabled: true,
					destination: "https://t.me/newchannel",
					expectedRevision: 3,
				},
			}),
		);
	});

	it("surfaces a conflict error from the server", async () => {
		mocks.update.mockRejectedValue(
			new Error("ההגדרה השתנה על ידי עורך אחר. רעננו את המסך ונסו שוב."),
		);
		view();
		const input = await screen.findByDisplayValue("https://t.me/alhaperek");
		fireEvent.change(input, { target: { value: "https://t.me/another" } });
		fireEvent.click(screen.getAllByRole("button", { name: "שמירה" })[0]);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"ההגדרה השתנה על ידי עורך אחר",
		);
	});

	it("clears a disabled destination and shows an audit entry without a timestamp", async () => {
		mocks.read.mockResolvedValue({
			links: [link()],
			audit: [
				{
					id: 6,
					channel: "telegram",
					enabled: false,
					destination: null,
					revision: 4,
					changedBy: null,
					changedAt: "",
				},
			],
		});
		view();
		const input = await screen.findByDisplayValue("https://t.me/alhaperek");
		expect(screen.getByRole("list")).toHaveTextContent("כבוי");
		expect(screen.getByRole("list")).not.toHaveTextContent("Invalid Date");
		fireEvent.click(screen.getByRole("checkbox"));
		fireEvent.change(input, { target: { value: "  " } });
		fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith({
				data: {
					channel: "telegram",
					enabled: false,
					destination: null,
					expectedRevision: 3,
				},
			}),
		);
	});

	it("shows a read failure without channel cards", async () => {
		mocks.read.mockRejectedValue(new Error("שגיאת מסד נתונים"));
		view();
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"שגיאת מסד נתונים",
		);
	});
});
