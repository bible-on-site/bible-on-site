/** @jest-environment node */
jest.mock("server-only", () => ({}));

import { GET } from "@/app/api/dev/coverage/route";

const nodeEnv = () =>
	(process.env as Record<string, string | undefined>).NODE_ENV;
const setNodeEnv = (value: string | undefined) => {
	(process.env as Record<string, string | undefined>).NODE_ENV = value;
};

const request = (host?: string) =>
	new Request("http://localhost/api/dev/coverage", {
		method: "GET",
		headers: host === undefined ? {} : { host },
	});

describe("/api/dev/coverage", () => {
	const originalEnv = nodeEnv();
	afterEach(() => {
		setNodeEnv(originalEnv);
		delete (global as unknown as { __coverage__?: unknown }).__coverage__;
	});

	describe("when NODE_ENV is production", () => {
		beforeEach(() => setNodeEnv("production"));

		it("rejects a localhost request", async () => {
			const res = await GET(request("localhost"));
			expect(res.status).toBe(403);
		});

		it("rejects a 127.0.0.1 request", async () => {
			const res = await GET(request("127.0.0.1:3001"));
			expect(res.status).toBe(403);
		});
	});

	describe("when NODE_ENV is development", () => {
		beforeEach(() => setNodeEnv("development"));

		it("rejects a host merely containing localhost as a substring", async () => {
			const res = await GET(request("attacker-localhost.example.com"));
			expect(res.status).toBe(403);
		});

		it("rejects a host merely containing 127.0.0.1 as a substring", async () => {
			const res = await GET(request("127.0.0.1.evil.com"));
			expect(res.status).toBe(403);
		});

		it("rejects a missing host header", async () => {
			const res = await GET(request());
			expect(res.status).toBe(403);
		});

		it("returns and drains the coverage object for localhost", async () => {
			(global as unknown as { __coverage__?: unknown }).__coverage__ = {
				"/srv/page.tsx": { hits: 3 },
			};
			const res = await GET(request("localhost:3001"));
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ "/srv/page.tsx": { hits: 3 } });
			expect(
				(global as unknown as { __coverage__?: unknown }).__coverage__,
			).toEqual({});
		});

		it("returns an empty object for 127.0.0.1 when no coverage exists", async () => {
			const res = await GET(request("127.0.0.1"));
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({});
		});
	});
});
