/** @jest-environment node */
const mockRequest = jest.fn();
jest.mock("@/lib/bulletin-signup", () => {
	const actual = jest.requireActual("@/lib/bulletin-signup/service");
	return {
		...actual,
		requestSignup: (...args: unknown[]) => mockRequest(...args),
		parseSignupBody: (...args: unknown[]) =>
			actual.parseSignupBody(...(args as [unknown])),
	};
});
jest.mock("server-only", () => ({}));

import { POST } from "@/app/api/bulletin/subscribe/route";

const request = (body: unknown, contentType = "application/json") =>
	new Request("http://localhost/api/bulletin/subscribe", {
		method: "POST",
		headers: { "content-type": contentType },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

describe("/api/bulletin/subscribe", () => {
	beforeEach(() => {
		mockRequest.mockReset().mockResolvedValue(undefined);
		jest.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => jest.restoreAllMocks());

	it("acknowledges a valid signup generically", async () => {
		const response = await POST(
			request({ email: "u@example.com", consent: true, source: "card" }),
		);
		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ status: "received" });
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(mockRequest).toHaveBeenCalledWith({
			email: "u@example.com",
			source: "card",
		});
	});

	it.each([
		["not json", "application/json"],
		["{}", "application/json"],
		[
			JSON.stringify({ email: "u@example.com", consent: true }),
			"application/json",
		],
		[
			JSON.stringify({
				email: "u@example.com",
				consent: true,
				source: "admin",
			}),
			"application/json",
		],
		[
			JSON.stringify({ email: "bad", consent: true, source: "card" }),
			"application/json",
		],
		[
			JSON.stringify({ email: "u@example.com", consent: true, source: "card" }),
			"text/plain",
		],
		["x".repeat(5000), "application/json"],
	])("rejects %s", async (body, contentType) => {
		const response = await POST(request(body, contentType));
		expect(response.status).toBe(400);
		expect(mockRequest).not.toHaveBeenCalled();
	});

	it("rejects an oversized streamed body without a truthful Content-Length", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("x".repeat(5000)));
				controller.close();
			},
		});
		const response = await POST(
			new Request("http://localhost/api/bulletin/subscribe", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: stream,
				duplex: "half",
			} as RequestInit),
		);
		expect(response.status).toBe(400);
		expect(mockRequest).not.toHaveBeenCalled();
	});

	it("returns 503 when the intent store fails", async () => {
		mockRequest.mockRejectedValue(new Error("db down"));
		const response = await POST(
			request({ email: "u@example.com", consent: true, source: "page" }),
		);
		expect(response.status).toBe(503);
	});

	it("rejects a missing content type", async () => {
		const response = await POST(
			new Request("http://localhost/api/bulletin/subscribe", {
				method: "POST",
			}),
		);
		expect(response.status).toBe(400);
		expect(mockRequest).not.toHaveBeenCalled();
	});

	it("rejects an oversized declared length before consuming the body", async () => {
		const response = await POST(
			new Request("http://localhost/api/bulletin/subscribe", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"content-length": "4097",
				},
				body: "{}",
			}),
		);
		expect(response.status).toBe(400);
		expect(mockRequest).not.toHaveBeenCalled();
	});

	it("rejects a JSON request without a body stream", async () => {
		const response = await POST(
			new Request("http://localhost/api/bulletin/subscribe", {
				method: "POST",
				headers: { "content-type": "application/json" },
			}),
		);
		expect(response.status).toBe(400);
		expect(mockRequest).not.toHaveBeenCalled();
	});
});
