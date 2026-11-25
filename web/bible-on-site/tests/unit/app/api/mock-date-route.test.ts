/** @jest-environment node */
import { DELETE, GET, POST } from "@/app/api/dev/mock-date/route";

const localhostHeaders = {
	host: "localhost",
	"content-type": "application/json",
};

const post = (body: unknown) =>
	POST(
		new Request("http://localhost/api/dev/mock-date", {
			method: "POST",
			headers: localhostHeaders,
			body: JSON.stringify(body),
		}),
	);

describe("/api/dev/mock-date", () => {
	const originalNodeEnv = process.env.NODE_ENV;
	const originalMockDate = process.env.MOCK_DATE;

	beforeEach(() => {
		process.env.NODE_ENV = "development";
		delete process.env.MOCK_DATE;
	});

	afterEach(() => {
		delete process.env.MOCK_DATE;
	});

	afterAll(() => {
		process.env.NODE_ENV = originalNodeEnv;
		if (originalMockDate === undefined) {
			delete process.env.MOCK_DATE;
		} else {
			process.env.MOCK_DATE = originalMockDate;
		}
	});

	it("rejects requests outside development mode", async () => {
		process.env.NODE_ENV = "test";

		const response = await post({ date: "2025-07-13T12:00:00+03:00" });

		expect(response.status).toBe(403);
	});

	it("sets MOCK_DATE and mirrors it in the mock-date cookie", async () => {
		const response = await post({ date: "2025-07-13T12:00:00+03:00" });

		expect(response.status).toBe(200);
		expect(process.env.MOCK_DATE).toBe("2025-07-13T09:00:00.000Z");
		const setCookie = decodeURIComponent(
			response.headers.get("set-cookie") ?? "",
		);
		expect(setCookie).toContain("mock-date=2025-07-13T09:00:00.000Z");
	});

	it("clears MOCK_DATE and the cookie when the body date is null", async () => {
		process.env.MOCK_DATE = "2025-07-13T09:00:00.000Z";

		const response = await post({ date: null });

		expect(response.status).toBe(200);
		expect(process.env.MOCK_DATE).toBeUndefined();
		expect(response.headers.get("set-cookie")).toContain("mock-date=;");
	});

	it("clears MOCK_DATE and the cookie on DELETE", async () => {
		process.env.MOCK_DATE = "2025-07-13T09:00:00.000Z";

		const response = DELETE(
			new Request("http://localhost/api/dev/mock-date", {
				method: "DELETE",
				headers: { host: "localhost" },
			}),
		);

		expect(response.status).toBe(200);
		expect(process.env.MOCK_DATE).toBeUndefined();
		expect(response.headers.get("set-cookie")).toContain("mock-date=;");
	});

	it("rejects an invalid date body", async () => {
		const response = await post({ date: "not-a-date" });

		expect(response.status).toBe(400);
		expect(process.env.MOCK_DATE).toBeUndefined();
		expect(response.headers.get("set-cookie")).toBeNull();
	});

	it("reports the current mock via GET", async () => {
		process.env.MOCK_DATE = "2025-07-13T09:00:00.000Z";

		const response = GET(
			new Request("http://localhost/api/dev/mock-date", {
				headers: { host: "localhost" },
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			mockedDate: "2025-07-13T09:00:00.000Z",
		});
	});
});
