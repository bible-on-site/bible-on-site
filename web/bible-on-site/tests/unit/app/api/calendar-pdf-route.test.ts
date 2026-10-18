/**
 * @jest-environment node
 */
import { GET } from "@/app/api/calendar-pdf/route";

function requestFor(path: string) {
	return GET(new Request(`http://localhost/api/calendar-pdf${path}`));
}

async function pdfBytes(res: Response): Promise<Buffer> {
	return Buffer.from(await res.arrayBuffer());
}

describe("GET /api/calendar-pdf", () => {
	it("rejects a missing or invalid month param", async () => {
		expect((await requestFor("")).status).toBe(400);
		expect((await requestFor("?month=abc")).status).toBe(400);
		expect((await requestFor("?month=5785")).status).toBe(400);
	});

	it("returns a PDF for a single month", async () => {
		const res = await requestFor("?month=578512");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("application/pdf");
		expect(res.headers.get("Content-Disposition")).toContain(
			'filename="learning-calendar-578512.pdf"',
		);
		const buf = await pdfBytes(res);
		expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
		expect(buf.length).toBeGreaterThan(10_000);
	});

	it("renders a full year across all months", async () => {
		const res = await requestFor("?month=578501&view=year");
		expect(res.status).toBe(200);
		const buf = await pdfBytes(res);
		expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
		expect(res.headers.get("Content-Disposition")).toContain(
			'filename="learning-calendar-year-5785.pdf"',
		);
	});

	// ~45 months of cells; generation is legitimately multi-second.
	it(
		"renders a full cycle with dimmed out-of-cycle days",
		async () => {
			const res = await requestFor("?month=578512&view=cycle&cycle=4");
			expect(res.status).toBe(200);
			const buf = await pdfBytes(res);
			expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
			expect(res.headers.get("Content-Disposition")).toContain(
				'filename="learning-calendar-cycle-4.pdf"',
			);
		},
		30_000,
	);

	it("falls back to the month view for an invalid cycle param", async () => {
		const res = await requestFor("?month=578512&view=cycle&cycle=abc");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Disposition")).toContain(
			'filename="learning-calendar-578512.pdf"',
		);
	});
});
