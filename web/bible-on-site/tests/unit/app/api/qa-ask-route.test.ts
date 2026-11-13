/**
 * @jest-environment node
 */

import { POST } from "@/app/api/qa/ask/route";

function request(body: unknown) {
	return new Request("http://localhost/api/qa/ask", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

describe("POST /api/qa/ask", () => {
	beforeEach(() => {
		global.fetch = jest.fn();
	});

	it("proxies the question and perekIds to the QA service", async () => {
		(global.fetch as jest.Mock).mockResolvedValue({
			status: 200,
			json: async () => ({ answers: [{ text: "a" }], noAnswer: false }),
		});

		const res = await POST(request({ question: "מה?", perekIds: [5] }));

		expect(res.status).toBe(200);
		const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
		expect(url).toBe("http://127.0.0.1:3004/ask");
		const sent = JSON.parse(init.body as string) as Record<string, unknown>;
		expect(sent).toEqual({ question: "מה?", perekIds: [5] });
	});

	it("omits perekIds when the array is empty or missing", async () => {
		(global.fetch as jest.Mock).mockResolvedValue({
			status: 200,
			json: async () => ({ answers: [], noAnswer: true }),
		});

		await POST(request({ question: "q", perekIds: [] }));
		const sent = JSON.parse(
			(global.fetch as jest.Mock).mock.calls[0][1].body as string,
		) as Record<string, unknown>;
		expect(sent).toEqual({ question: "q" });
	});

	it("forwards the QA service status and body", async () => {
		(global.fetch as jest.Mock).mockResolvedValue({
			status: 503,
			json: async () => ({ error: "busy" }),
		});

		const res = await POST(request({ question: "q" }));
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: "busy" });
	});

	it("returns 400 noAnswer on malformed JSON", async () => {
		const res = await POST(request("{not json"));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ answers: [], noAnswer: true });
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("sends an empty question and ignores non-array perekIds", async () => {
		(global.fetch as jest.Mock).mockResolvedValue({
			status: 200,
			json: async () => ({ answers: [], noAnswer: true }),
		});

		await POST(request({ perekIds: "5" }));
		const sent = JSON.parse(
			(global.fetch as jest.Mock).mock.calls[0][1].body as string,
		) as Record<string, unknown>;
		expect(sent).toEqual({ question: "" });
	});

	it("returns noAnswer when the QA service is unreachable", async () => {
		(global.fetch as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED"));
		const res = await POST(request({ question: "q" }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ answers: [], noAnswer: true });
	});

	it("aborts the upstream request when the QA service stalls past the timeout", async () => {
		jest.useFakeTimers();
		try {
			(global.fetch as jest.Mock).mockImplementation(
				(_url: string, init?: RequestInit) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () =>
							reject(
								new DOMException(
									"The operation was aborted.",
									"AbortError",
								),
							),
						);
					}),
			);

			const pending = POST(request({ question: "מה?" }));
			await jest.advanceTimersByTimeAsync(8000);
			const res = await pending;

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ answers: [], noAnswer: true });
		} finally {
			jest.useRealTimers();
		}
	});
});
