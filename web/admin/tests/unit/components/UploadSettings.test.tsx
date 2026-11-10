import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { UploadSettings } from "~/components/UploadSettings";
import { getUploadSettings, setUploadQuota } from "~/server/archive";

vi.mock("~/server/archive", () => ({
	getUploadSettings: vi.fn(),
	setUploadQuota: vi.fn(),
}));
const settings = {
	quota: 1_000_000_000_000,
	users: [
		{
			userId: "alice",
			username: "alice",
			displayName: "alice",
			quota: 5_000_000_000,
			allocated: 1_000_000_000,
		},
		{
			userId: "bob",
			username: "bob",
			displayName: "bob",
			quota: null,
			allocated: 0,
		},
	],
};
beforeEach(() => {
	vi.mocked(getUploadSettings).mockResolvedValue(settings);
	vi.mocked(setUploadQuota).mockResolvedValue({ ok: true });
});

it("loads quotas and saves the global default in GB", async () => {
	render(<UploadSettings />);
	const input = await screen.findByLabelText("מכסת ברירת מחדל לכל משתמש (GB)");
	expect(input).toHaveValue(1000);
	fireEvent.change(input, { target: { value: "500" } });
	fireEvent.click(screen.getAllByRole("button", { name: "שמירה" })[0]);
	await waitFor(() =>
		expect(setUploadQuota).toHaveBeenCalledWith({
			data: { gb: 500, userId: undefined },
		}),
	);
	expect(await screen.findByText("המכסה נשמרה")).toBeVisible();
});
it("saves individual overrides and restores the default", async () => {
	render(<UploadSettings />);
	const input = await screen.findByLabelText("מכסה אישית עבור alice (GB)");
	expect(input).toHaveValue(5);
	fireEvent.change(input, { target: { value: "0" } });
	fireEvent.click(screen.getAllByRole("button", { name: "שמירה" })[1]);
	await waitFor(() =>
		expect(setUploadQuota).toHaveBeenCalledWith({
			data: { gb: 0, userId: "alice" },
		}),
	);
	await waitFor(() =>
		expect(screen.getAllByText("שימוש במכסת ברירת המחדל")[0]).toBeEnabled(),
	);
	fireEvent.click(screen.getAllByText("שימוש במכסת ברירת המחדל")[0]);
	await waitFor(() =>
		expect(setUploadQuota).toHaveBeenCalledWith({
			data: { gb: null, userId: "alice" },
		}),
	);
	expect(screen.getAllByText("שימוש במכסת ברירת המחדל")[1]).toBeDisabled();
});
it("shows an empty directory list", async () => {
	vi.mocked(getUploadSettings).mockResolvedValue({
		quota: 1_000_000_000_000,
		users: [],
	});
	render(<UploadSettings />);
	expect(await screen.findByText("עדיין אין תיקיות משתמשים.")).toBeVisible();
});
it("reports load failures", async () => {
	vi.mocked(getUploadSettings).mockRejectedValue(new Error("load failed"));
	render(<UploadSettings />);
	expect(await screen.findByText("load failed")).toBeVisible();
});
it("reports save failures", async () => {
	vi.mocked(setUploadQuota).mockRejectedValue(new Error("save failed"));
	render(<UploadSettings />);
	await screen.findByLabelText("מכסת ברירת מחדל לכל משתמש (GB)");
	fireEvent.click(screen.getAllByRole("button", { name: "שמירה" })[0]);
	expect(await screen.findByText("save failed")).toBeVisible();
});
