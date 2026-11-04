/** @jest-environment node */
const mockResolve = jest.fn();
jest.mock("@/lib/bulletin-join", () => {
	const actual = jest.requireActual("@/lib/bulletin-join/service");
	return { ...actual, resolveJoinDestination: (...args: unknown[]) => mockResolve(...args) };
});
jest.mock("server-only", () => ({}));

import { GET, HEAD } from "@/app/join/[channel]/route";

const context = (channel: string) => ({
	params: Promise.resolve({ channel }),
});
const REQ = new Request("https://example.com/join/telegram");

describe("/join/[channel]", () => {
	beforeEach(() => {
		mockResolve.mockReset();
		jest.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => jest.restoreAllMocks());

	it("redirects temporarily to the resolved destination with no-store", async () => {
		mockResolve.mockResolvedValue("https://t.me/alhaperek");
		const response = await GET(REQ, context("telegram"));
		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("https://t.me/alhaperek");
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("returns the redirect without a body on HEAD", async () => {
		mockResolve.mockResolvedValue("https://chat.whatsapp.com/AbCdEfGh1234567890");
		const response = await HEAD(REQ, context("whatsapp"));
		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe(
			"https://chat.whatsapp.com/AbCdEfGh1234567890",
		);
		expect(await response.text()).toBe("");
	});

	it("404s for a channel outside the contract without querying", async () => {
		const response = await GET(REQ, context("email"));
		expect(response.status).toBe(404);
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it("serves the unavailable page when no destination is configured", async () => {
		mockResolve.mockResolvedValue(null);
		const response = await GET(REQ, context("whatsapp"));
		expect(response.status).toBe(503);
		expect(response.headers.get("cache-control")).toBe("no-store");
		const body = await response.text();
		expect(body).toContain("ווטסאפ");
		expect(body).toContain("/dailyBulletin");
	});

	it("serves the unavailable page when the lookup fails", async () => {
		mockResolve.mockRejectedValue(new Error("db down"));
		const response = await GET(REQ, context("telegram"));
		expect(response.status).toBe(503);
	});
});
