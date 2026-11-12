import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	randomInt: vi.fn(),
	query: vi.fn(),
	queryOne: vi.fn(),
	render: vi.fn(),
	getConnection: vi.fn(),
	beginTransaction: vi.fn(),
	execute: vi.fn(),
	commit: vi.fn(),
	rollback: vi.fn(),
	release: vi.fn(),
}));
vi.mock("node:crypto", () => ({ randomInt: mocks.randomInt }));
vi.mock("~/server/db", () => ({
	query: mocks.query,
	queryOne: mocks.queryOne,
	pool: { getConnection: mocks.getConnection },
}));
vi.mock("~/server/render-daily.server", () => ({
	renderDailyBulletin: mocks.render,
}));

import {
	prepareBulletin,
	readBulletinEmailContent,
	readPreparedBulletin,
} from "~/server/daily-bulletins.server";

const input = {
	date: "2026-10-08",
	hebrewDate: "כז תשרי תשפז",
	perekId: 1,
	article: { id: 7, title: "מאמר", author: "מחבר", html: "<p>תוכן</p>" },
	dedications: [],
};
const row = {
	input_json: input,
	subject: "עלון",
	source: "בראשית א",
	email_html: "<p>העלון</p>",
	pdf_data: Buffer.from("%PDF-1.7"),
	filename: "bulletin.pdf",
};
const deliveries = [
	{ channel: "email", status: "pending" },
	{ channel: "telegram", status: "pending" },
	{ channel: "whatsapp", status: "pending" },
];

describe("prepared bulletins", () => {
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockReset();
		mocks.randomInt.mockReturnValue(0);
		mocks.getConnection.mockResolvedValue(mocks);
		mocks.render.mockResolvedValue({
			subject: row.subject,
			source: row.source,
			emailHtml: row.email_html,
			pdfBase64: row.pdf_data.toString("base64"),
			filename: row.filename,
		});
	});
	it("reuses stored content without selecting or rendering another article", async () => {
		mocks.queryOne.mockResolvedValue(row);
		mocks.query.mockResolvedValue(deliveries);
		const result = await prepareBulletin(input.date);
		expect(result.input.article?.id).toBe(7);
		expect(result.pdfBase64).toBe(row.pdf_data.toString("base64"));
		expect(mocks.render).not.toHaveBeenCalled();
		expect(mocks.getConnection).not.toHaveBeenCalled();
	});
	it("snapshots the selected article and records all three pending channels atomically", async () => {
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 1 })
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(row);
		mocks.query
			.mockResolvedValueOnce([
				{ id: 7, name: "מאמר", author: "מחבר", content: "<p>תוכן</p>" },
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(deliveries);
		const result = await prepareBulletin(input.date);
		expect(mocks.render).toHaveBeenCalledWith(input);
		expect(mocks.execute).toHaveBeenCalledTimes(4);
		expect(mocks.beginTransaction).toHaveBeenCalledOnce();
		expect(mocks.commit).toHaveBeenCalledOnce();
		expect(mocks.release).toHaveBeenCalledOnce();
		expect(result.delivery).toEqual(deliveries);
	});
	it("randomizes over written candidates after filtering recording-only entries", async () => {
		const selected = {
			id: 8,
			title: "מאמר נוסף",
			author: "מחבר",
			html: "<p>תוכן נוסף</p>",
		};
		mocks.randomInt.mockReturnValue(1);
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 1 })
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({
				...row,
				input_json: { ...input, article: selected },
			});
		mocks.query
			.mockResolvedValueOnce([
				{
					id: 9,
					name: "שיעור",
					author: "מחבר",
					content:
						'<h1>שיעור</h1><h2>להאזנה</h2><audio><a href="lesson.opus">להאזנה לשיעור</a></audio>',
				},
				{
					id: 10,
					name: "שיעור",
					author: "מחבר",
					content:
						'<h1>שיעור</h1><h2>לצפייה</h2><video src="lesson.webm"></video>',
				},
				{ id: 7, name: "מאמר", author: "מחבר", content: "<p>תוכן</p>" },
				{
					id: 8,
					name: selected.title,
					author: selected.author,
					content: selected.html,
				},
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(deliveries);
		await prepareBulletin(input.date);
		expect(mocks.randomInt).toHaveBeenCalledExactlyOnceWith(2);
		expect(mocks.render).toHaveBeenCalledWith({ ...input, article: selected });
		expect(mocks.query.mock.calls[0][0]).toContain("a.distributable = TRUE");
	});
	it.each([
		["2026-11-08", 311],
		["2026-11-09", 312],
	] as const)(
		"includes the newly approved written article for %s (perek %i)",
		async (date, perekId) => {
			mocks.queryOne
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ perek_id: perekId })
				.mockResolvedValueOnce(null)
				.mockImplementationOnce(async () => ({
					...row,
					input_json: JSON.parse(mocks.execute.mock.calls[0][1][3]),
				}));
			mocks.query
				.mockResolvedValueOnce([
					{ id: 7, name: "מאמר", author: "מחבר", content: "<p>תוכן</p>" },
				])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce(deliveries);
			const prepared = await prepareBulletin(date);
			expect(prepared.input.perekId).toBe(perekId);
			expect(prepared.input.article).toEqual(input.article);
			expect(prepared.delivery).toEqual(deliveries);
			expect(mocks.render).toHaveBeenCalledWith(
				expect.objectContaining({ date, perekId, article: input.article }),
			);
		},
	);
	it("excludes a recording-only candidate even when its approval box is checked", async () => {
		const html =
			'<h1>שיעור</h1><h2>להאזנה</h2><audio controls><source src="lesson.opus"><a href="lesson.opus">להאזנה לשיעור</a></audio>';
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 1 })
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({
				...row,
				input_json: { ...input, article: null },
			});
		mocks.query
			.mockResolvedValueOnce([
				{ id: 7, name: "שיעור", author: "מחבר", content: html },
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(deliveries);
		const prepared = await prepareBulletin(input.date);
		expect(prepared.input.article).toBeNull();
		expect(mocks.render).toHaveBeenCalledWith({ ...input, article: null });
		expect(mocks.randomInt).not.toHaveBeenCalled();
	});
	it("returns the stored winner when another request prepared the date first", async () => {
		const winner = {
			...row,
			input_json: { ...input, article: { ...input.article, id: 42 } },
		};
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 1 })
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(winner);
		mocks.query
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(deliveries);
		const result = await prepareBulletin(input.date);
		expect(mocks.render.mock.calls[0]?.[0].article).toBeNull();
		expect(result.input.article?.id).toBe(42);
	});
	it("rolls back and releases the connection when channel initialization fails", async () => {
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 1 })
			.mockResolvedValueOnce(null);
		mocks.query.mockResolvedValue([]);
		mocks.execute
			.mockResolvedValueOnce({})
			.mockRejectedValueOnce(new Error("DB failure"));
		await expect(prepareBulletin(input.date)).rejects.toThrow("DB failure");
		expect(mocks.rollback).toHaveBeenCalledOnce();
		expect(mocks.commit).not.toHaveBeenCalled();
		expect(mocks.release).toHaveBeenCalledOnce();
	});
	it("does not save a bulletin when rendering fails", async () => {
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 1 })
			.mockResolvedValueOnce(null);
		mocks.query.mockResolvedValue([]);
		mocks.render.mockRejectedValue(new Error("Rendering failed"));
		await expect(prepareBulletin(input.date)).rejects.toThrow(
			"Rendering failed",
		);
		expect(mocks.getConnection).not.toHaveBeenCalled();
	});
	it("resolves a Saturday preview to Thursday and refuses unmapped dates", async () => {
		mocks.queryOne.mockResolvedValue(null);
		await expect(prepareBulletin("2026-10-10")).rejects.toThrow("לא נמצא פרק");
		expect(mocks.queryOne.mock.calls[1]?.[1]).toEqual(["2026-10-08"]);
		expect(mocks.render).not.toHaveBeenCalled();
	});
	it("reads snapshots returned as JSON text by the database driver", async () => {
		mocks.queryOne.mockResolvedValue({
			...row,
			input_json: JSON.stringify(input),
		});
		mocks.query.mockResolvedValue(deliveries);
		expect((await readPreparedBulletin(input.date))?.input).toEqual(input);
	});
	it("reads email content without the PDF blob", async () => {
		mocks.queryOne.mockResolvedValue({
			subject: row.subject,
			emailHtml: row.email_html,
		});
		expect(await readBulletinEmailContent(input.date)).toEqual({
			subject: row.subject,
			emailHtml: row.email_html,
		});
		expect(String(mocks.queryOne.mock.calls[0][0])).not.toContain("pdf_data");
	});
	it("includes chapter dedications in the saved input and reports a missing post-commit snapshot", async () => {
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 1 })
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null);
		mocks.query
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ subject: "לזכרון" }, { subject: "לרפואה" }]);
		await expect(prepareBulletin(input.date)).rejects.toThrow(
			"שמירת העלון נכשלה",
		);
		expect(mocks.render).toHaveBeenCalledWith({
			...input,
			article: null,
			dedications: ["לזכרון", "לרפואה"],
		});
		const storedInput = JSON.parse(mocks.execute.mock.calls[0][1][3]);
		expect(storedInput.dedications).toEqual(["לזכרון", "לרפואה"]);
		expect(mocks.commit).toHaveBeenCalledOnce();
		expect(mocks.release).toHaveBeenCalledOnce();
	});
});

describe("Hebrew-date article override (#3098)", () => {
	const assigned = {
		id: 2199,
		name: "מאמר לתאריך",
		author: "מחבר מיוחד",
		content: "<p>תוכן התאריך</p>",
		distributable: 1,
	};

	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockReset();
		mocks.randomInt.mockReturnValue(0);
		mocks.getConnection.mockResolvedValue(mocks);
		mocks.render.mockResolvedValue({
			subject: row.subject,
			source: row.source,
			emailHtml: row.email_html,
			pdfBase64: row.pdf_data.toString("base64"),
			filename: row.filename,
		});
	});

	it("makes the assigned article the sole winner without random selection", async () => {
		// 2024-08-13 is 9 Av 5784 — the assignment lookup must get (11, 9).
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 700 })
			.mockResolvedValueOnce(assigned)
			.mockResolvedValueOnce(row);
		mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce(deliveries);
		await prepareBulletin("2024-08-13");
		expect(mocks.queryOne.mock.calls[2]?.[1]).toEqual([11, 9]);
		// The candidate-article query for the perek never ran — the only
		// query() calls are dedications and the read-back delivery list.
		expect(mocks.query.mock.calls[0]?.[0]).toContain("tanah_dedication");
		expect(mocks.render).toHaveBeenCalledWith(
			expect.objectContaining({
				article: {
					id: 2199,
					title: "מאמר לתאריך",
					author: "מחבר מיוחד",
					html: "<p>תוכן התאריך</p>",
				},
			}),
		);
		// The stored snapshot carries the same assigned article — the
		// persisted bulletin is internally consistent with what was rendered.
		const storedInput = JSON.parse(mocks.execute.mock.calls[0][1][3]);
		expect(storedInput.article.id).toBe(2199);
	});

	it("rejects an assigned article that is not distribution-eligible", async () => {
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 700 })
			.mockResolvedValueOnce({ ...assigned, distributable: 0 });
		await expect(prepareBulletin("2024-08-13")).rejects.toThrow(
			"אינו זמין להפצה",
		);
		expect(mocks.render).not.toHaveBeenCalled();
	});

	it("rejects an assigned article with an empty body", async () => {
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 700 })
			.mockResolvedValueOnce({ ...assigned, content: "   " });
		await expect(prepareBulletin("2024-08-13")).rejects.toThrow(
			"אינו זמין להפצה",
		);
	});
	it("rejects an approved recurring-date article that only contains a recording", async () => {
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 700 })
			.mockResolvedValueOnce({
				...assigned,
				content: '<h1>שיעור</h1><audio src="lesson.opus"></audio>',
			});
		await expect(prepareBulletin("2024-08-13")).rejects.toThrow(
			"אינו זמין להפצה",
		);
		expect(mocks.render).not.toHaveBeenCalled();
	});

	it("resolves the TARGET Hebrew date, not the Thursday study date, on Fridays", async () => {
		// Friday 2024-08-16 is 12 Av 5784; its study chapter comes from
		// Thursday the 15th, but the article override follows 12 Av.
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 700 })
			.mockResolvedValueOnce(assigned)
			.mockResolvedValueOnce(row);
		mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce(deliveries);
		await prepareBulletin("2024-08-16");
		expect(mocks.queryOne.mock.calls[1]?.[1]).toEqual(["2024-08-15"]);
		expect(mocks.queryOne.mock.calls[2]?.[1]).toEqual([11, 12]);
	});

	it("rejects an assigned article with a null body", async () => {
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 700 })
			.mockResolvedValueOnce({ ...assigned, content: null });
		await expect(prepareBulletin("2024-08-13")).rejects.toThrow(
			"אינו זמין להפצה",
		);
	});

	it("falls back to ordinary selection when the date schema is not deployed", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 1 })
			.mockRejectedValueOnce(
				Object.assign(new Error("no such table"), {
					code: "ER_NO_SUCH_TABLE",
				}),
			)
			.mockResolvedValueOnce(row);
		mocks.query
			.mockResolvedValueOnce([
				{ id: 7, name: "מאמר", author: "מחבר", content: "<p>תוכן</p>" },
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(deliveries);
		const result = await prepareBulletin(input.date);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Hebrew-date schema"),
		);
		expect(result.input.article?.id).toBe(7);
		warn.mockRestore();
	});

	it("rethrows a non-schema failure from the assignment lookup", async () => {
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 1 })
			.mockRejectedValueOnce(new Error("deadlock"));
		await expect(prepareBulletin(input.date)).rejects.toThrow("deadlock");
	});

	it("keeps ordinary chapter selection when the date has no assignment", async () => {
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 1 })
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(row);
		mocks.query
			.mockResolvedValueOnce([
				{ id: 7, name: "מאמר", author: "מחבר", content: "<p>תוכן</p>" },
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(deliveries);
		const result = await prepareBulletin(input.date);
		expect(mocks.render).toHaveBeenCalledWith(input);
		expect(result.input.article?.id).toBe(7);
	});
});
