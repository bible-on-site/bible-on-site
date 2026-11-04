/** @jest-environment node */
const mockConfirm = jest.fn();
jest.mock("@/lib/bulletin-signup", () => ({
	confirmSignup: (...args: unknown[]) => mockConfirm(...args),
}));
jest.mock("server-only", () => ({}));

import { POST } from "@/app/api/bulletin/confirm/route";

const jsonRequest = (body: unknown) =>
	new Request("http://localhost/api/bulletin/confirm", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
const formRequest = (token: string) =>
	new Request("http://localhost/api/bulletin/confirm", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: `token=${encodeURIComponent(token)}`,
	});
const TOKEN = "a".repeat(43);

describe("/api/bulletin/confirm", () => {
	beforeEach(() => {
		mockConfirm.mockReset();
		jest.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => jest.restoreAllMocks());

	it.each([
		["confirmed", 200],
		["expired", 410],
		["invalid", 404],
	] as const)("returns %s with status %i", async (outcome, status) => {
		mockConfirm.mockResolvedValue(outcome);
		const response = await POST(jsonRequest({ token: TOKEN }));
		expect(response.status).toBe(status);
		expect(await response.json()).toEqual({ status: outcome });
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(mockConfirm).toHaveBeenCalledWith(TOKEN);
	});

	it("treats a missing token as invalid input", async () => {
		mockConfirm.mockResolvedValue("invalid");
		const response = await POST(jsonRequest({}));
		expect(response.status).toBe(404);
		expect(mockConfirm).toHaveBeenCalledWith("");
	});

	it("redirects a no-JS form post back to the confirm page", async () => {
		mockConfirm.mockResolvedValue("confirmed");
		const response = await POST(formRequest(TOKEN));
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			"http://localhost/join/email/confirm?outcome=confirmed",
		);
	});

	it("redirects form posts to the error outcome on failure", async () => {
		mockConfirm.mockRejectedValue(new Error("db down"));
		const response = await POST(formRequest(TOKEN));
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			"http://localhost/join/email/confirm?outcome=error",
		);
	});

	it("returns 503 when confirmation fails", async () => {
		mockConfirm.mockRejectedValue(new Error("db down"));
		const response = await POST(jsonRequest({ token: TOKEN }));
		expect(response.status).toBe(503);
	});
});
