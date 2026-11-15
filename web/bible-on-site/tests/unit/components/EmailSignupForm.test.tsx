/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EmailSignupForm } from "@/app/components/EmailSignupForm";
import { CONSENT_TEXT } from "@/lib/bulletin-signup/shared";

describe("EmailSignupForm", () => {
	const mockFetch = jest.fn();
	beforeEach(() => {
		mockFetch.mockReset();
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});
	afterEach(() => jest.restoreAllMocks());

	function fillAndSubmit() {
		fireEvent.change(screen.getByLabelText(/כתובת דוא"ל/), {
			target: { value: "u@example.com" },
		});
		fireEvent.click(screen.getByRole("checkbox"));
		fireEvent.click(screen.getByRole("button", { name: "הרשמה" }));
	}

	it("posts the email, consent and source to the signup API", async () => {
		mockFetch.mockResolvedValue({ ok: true } as Response);
		render(<EmailSignupForm source="card" />);
		fillAndSubmit();
		await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
		expect(mockFetch).toHaveBeenCalledWith("/api/bulletin/subscribe", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "u@example.com",
				consent: true,
				source: "card",
			}),
		});
		expect(await screen.findByRole("status")).toHaveTextContent(
			/ההרשמה התקבלה/,
		);
	});

	it("shows the recorded consent text on the checkbox", () => {
		render(<EmailSignupForm source="page" />);
		expect(screen.getByRole("checkbox")).toBeRequired();
		expect(screen.getByText(CONSENT_TEXT)).toBeInTheDocument();
	});

	it("keeps the form and shows an error when the API fails", async () => {
		mockFetch.mockResolvedValue({ ok: false, status: 503 } as Response);
		render(<EmailSignupForm source="card" />);
		fillAndSubmit();
		expect(await screen.findByRole("alert")).toHaveTextContent(/נסו שוב/);
		expect(screen.getByRole("button", { name: "הרשמה" })).toBeEnabled();
	});

	it("shows an error when fetch rejects", async () => {
		mockFetch.mockRejectedValue(new Error("offline"));
		render(<EmailSignupForm source="card" />);
		fillAndSubmit();
		expect(await screen.findByRole("alert")).toBeInTheDocument();
	});

	it("does not double-submit while pending", async () => {
		let resolveFetch: (value: Response) => void = () => {};
		mockFetch.mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					resolveFetch = resolve;
				}),
		);
		render(<EmailSignupForm source="card" />);
		fillAndSubmit();
		fireEvent.click(screen.getByRole("button", { name: "שולח…" }));
		fireEvent.submit(
			screen
				.getByRole("button", { name: "שולח…" })
				.closest("form") as HTMLFormElement,
		);
		expect(mockFetch).toHaveBeenCalledTimes(1);
		resolveFetch({ ok: true } as Response);
		expect(await screen.findByRole("status")).toBeInTheDocument();
	});
});
