/** @jest-environment node */
const mockConfirm = jest.fn();
jest.mock("@/lib/bulletin-signup", () => ({
	confirmSignup: (...args: unknown[]) => mockConfirm(...args),
	isChallengeToken: (value: unknown) =>
		typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value),
}));
jest.mock("server-only", () => ({}));
const mockCookieGet = jest.fn();
jest.mock("next/headers", () => ({
	cookies: () => Promise.resolve({ get: mockCookieGet }),
}));

import { GET, POST } from "@/app/api/bulletin/confirm/route";

const jsonRequest = (body: unknown) =>
	new Request("http://localhost/api/bulletin/confirm", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
const formRequest = (token: string | null) =>
	new Request("http://localhost/api/bulletin/confirm", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: token === null ? "" : `token=${encodeURIComponent(token)}`,
	});
const TOKEN = "a".repeat(43);

describe("/api/bulletin/confirm", () => {
	beforeEach(() => {
		mockConfirm.mockReset();
		mockCookieGet.mockReset().mockReturnValue(undefined);
		jest.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => jest.restoreAllMocks());

	describe("GET", () => {
		it("stages a valid mailed token in an HttpOnly cookie and redirects", async () => {
			const response = await GET(
				new Request(
					`http://localhost/api/bulletin/confirm?t=${TOKEN}`,
				),
			);
			expect(response.status).toBe(303);
			expect(response.headers.get("location")).toBe(
				"http://localhost/join/email/confirm",
			);
			const setCookie = response.headers.get("set-cookie") ?? "";
			expect(setCookie).toContain(`bulletin_confirm=${TOKEN}`);
			expect(setCookie).toMatch(/httponly/i);
			expect(setCookie).toMatch(/samesite=strict/i);
			expect(setCookie).toContain("Path=/api/bulletin");
		});

		it.each(["bad", "", "a".repeat(44)])(
			"redirects without staging a malformed token %j",
			async (t) => {
				const response = await GET(
					new Request(`http://localhost/api/bulletin/confirm?t=${t}`),
				);
				expect(response.status).toBe(303);
				expect(response.headers.get("set-cookie")).toBeNull();
			},
		);
	});

	describe("POST", () => {
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

		it("confirms from the staged cookie when the body carries no token", async () => {
			mockCookieGet.mockReturnValue({ value: TOKEN });
			mockConfirm.mockResolvedValue("confirmed");
			const response = await POST(
				new Request("http://localhost/api/bulletin/confirm", {
					method: "POST",
				}),
			);
			expect(response.status).toBe(200);
			expect(mockConfirm).toHaveBeenCalledWith(TOKEN);
		});

		it("clears the staged cookie once the outcome resolves", async () => {
			mockCookieGet.mockReturnValue({ value: TOKEN });
			mockConfirm.mockResolvedValue("confirmed");
			const response = await POST(
				new Request("http://localhost/api/bulletin/confirm", {
					method: "POST",
				}),
			);
			expect(response.headers.get("set-cookie")).toMatch(
				/bulletin_confirm=;.*(expires|max-age)/i,
			);
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

		it("confirms a no-JS form post through the staged cookie", async () => {
			mockCookieGet.mockReturnValue({ value: TOKEN });
			mockConfirm.mockResolvedValue("confirmed");
			const response = await POST(formRequest(null));
			expect(response.status).toBe(303);
			expect(response.headers.get("location")).toBe(
				"http://localhost/join/email/confirm?outcome=confirmed",
			);
			expect(mockConfirm).toHaveBeenCalledWith(TOKEN);
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
});
