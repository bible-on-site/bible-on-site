/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfirmEmailForm } from "@/app/join/email/confirm/ConfirmEmailForm";

describe("ConfirmEmailForm", () => {
	const mockFetch = jest.fn();
	beforeEach(() => {
		mockFetch.mockReset();
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});
	afterEach(() => jest.restoreAllMocks());

	it("posts to the confirm endpoint and lets the staged cookie carry the token", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => ({ status: "confirmed" }),
		} as Response);
		render(<ConfirmEmailForm />);
		fireEvent.click(screen.getByRole("button", { name: "אישור ההרשמה" }));
		await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
		// The challenge rides in the HttpOnly cookie — no token in the request
		// body or anywhere in the DOM.
		expect(mockFetch).toHaveBeenCalledWith("/api/bulletin/confirm", {
			method: "POST",
		});
		expect(document.querySelector("input[name='token']")).toBeNull();
		expect(await screen.findByRole("status")).toHaveTextContent(/אושרה בהצלחה/);
	});

	it("works as a plain form post without JavaScript", () => {
		render(<ConfirmEmailForm />);
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
		render(<ConfirmEmailForm />);
		fireEvent.click(screen.getByRole("button", { name: "אישור ההרשמה" }));
		expect(await screen.findByRole("status")).toHaveTextContent(pattern);
	});

	it("keeps the form with a retry message on failure", async () => {
		mockFetch.mockRejectedValue(new Error("offline"));
		render(<ConfirmEmailForm />);
		fireEvent.click(screen.getByRole("button", { name: "אישור ההרשמה" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(/נסו שוב/);
		expect(
			screen.getByRole("button", { name: "אישור ההרשמה" }),
		).toBeInTheDocument();
	});
});
