/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfirmEmailForm } from "@/app/join/email/confirm/ConfirmEmailForm";

const TOKEN = "a".repeat(43);

describe("ConfirmEmailForm", () => {
	const mockFetch = jest.fn();
	beforeEach(() => {
		mockFetch.mockReset();
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});
	afterEach(() => jest.restoreAllMocks());

	it("posts the token to the confirm endpoint", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => ({ status: "confirmed" }),
		} as Response);
		render(<ConfirmEmailForm token={TOKEN} />);
		fireEvent.click(screen.getByRole("button", { name: "אישור ההרשמה" }));
		await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
		expect(mockFetch).toHaveBeenCalledWith("/api/bulletin/confirm", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token: TOKEN }),
		});
		expect(await screen.findByRole("status")).toHaveTextContent(/אושרה בהצלחה/);
	});

	it("works as a plain form post without JavaScript", () => {
		render(<ConfirmEmailForm token={TOKEN} />);
		const form = document.querySelector("form") as HTMLFormElement;
		expect(form).toHaveAttribute("method", "post");
		expect(form).toHaveAttribute("action", "/api/bulletin/confirm");
	});

	it.each([
		["expired", /תוקף קישור האימות פג/],
		["invalid", /אינו תקף/],
	] as const)("shows the %s outcome", async (status, pattern) => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => ({ status }),
		} as Response);
		render(<ConfirmEmailForm token={TOKEN} />);
		fireEvent.click(screen.getByRole("button", { name: "אישור ההרשמה" }));
		expect(await screen.findByRole("status")).toHaveTextContent(pattern);
	});

	it("keeps the form with a retry message on failure", async () => {
		mockFetch.mockRejectedValue(new Error("offline"));
		render(<ConfirmEmailForm token={TOKEN} />);
		fireEvent.click(screen.getByRole("button", { name: "אישור ההרשמה" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(/נסו שוב/);
		expect(
			screen.getByRole("button", { name: "אישור ההרשמה" }),
		).toBeInTheDocument();
	});
});
