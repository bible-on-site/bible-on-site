import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
		const result = await prepareBulletin(input.date, { requireArticle: true });
		expect(mocks.render).toHaveBeenCalledWith(input);
		expect(mocks.execute).toHaveBeenCalledTimes(4);
		expect(mocks.beginTransaction).toHaveBeenCalledOnce();
		expect(mocks.commit).toHaveBeenCalledOnce();
		expect(mocks.release).toHaveBeenCalledOnce();
		expect(result.delivery).toEqual(deliveries);
	});
	it.each([
		["2026-11-08", 311],
		["2026-11-09", 312],
	] as const)(
		"refuses to freeze an article-free scheduled bulletin for %s (perek %i)",
		async (date, perekId) => {
			// Production had articles for both chapters, but none approved. The
			// candidate query therefore returns no rows, not a rendering failure.
			mocks.queryOne
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ perek_id: perekId })
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({
					...row,
					input_json: { ...input, date, perekId, article: null },
				});
			mocks.query.mockResolvedValue([]);
			await expect(
				prepareBulletin(date, { requireArticle: true }),
			).rejects.toThrow(
				`No approved article for bulletin ${date} (perek ${perekId})`,
			);
			expect(mocks.render).not.toHaveBeenCalled();
			expect(mocks.getConnection).not.toHaveBeenCalled();
		},
	);
	it.each(["pending", "sent", "uncertain"])(
		"rejects a stored article-free bulletin with %s deliveries without changing its snapshot",
		async (status) => {
			mocks.queryOne.mockResolvedValue({
				...row,
				input_json: { ...input, perekId: 311, article: null },
			});
			mocks.query.mockResolvedValue(
				deliveries.map((delivery) => ({ ...delivery, status })),
			);
			await expect(
				prepareBulletin(input.date, { requireArticle: true }),
			).rejects.toThrow("No approved article");
			expect(mocks.queryOne).toHaveBeenCalledTimes(1);
			expect(mocks.render).not.toHaveBeenCalled();
			expect(mocks.getConnection).not.toHaveBeenCalled();
		},
	);
	it("allows a saved approved article for scheduled delivery", async () => {
		mocks.queryOne.mockResolvedValue(row);
		mocks.query.mockResolvedValue(deliveries);
		expect(
			(await prepareBulletin(input.date, { requireArticle: true })).input
				.article,
		).toEqual(input.article);
		expect(mocks.render).not.toHaveBeenCalled();
	});
	it("can prepare the same date after approval because the failed attempt saved nothing", async () => {
		const date = "2026-11-08";
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 311 })
			.mockResolvedValueOnce(null);
		mocks.query.mockResolvedValueOnce([]);
		await expect(
			prepareBulletin(date, { requireArticle: true }),
		).rejects.toThrow("No approved article");
		expect(mocks.getConnection).not.toHaveBeenCalled();
		const ready = {
			...row,
			input_json: { ...input, date, perekId: 311 },
		};
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 311 })
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(ready);
		mocks.query
			.mockResolvedValueOnce([
				{ id: 7, name: "מאמר", author: "מחבר", content: "<p>תוכן</p>" },
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(deliveries);
		expect(
			(await prepareBulletin(date, { requireArticle: true })).input.article,
		).toEqual(input.article);
		expect(mocks.render).toHaveBeenCalledOnce();
		expect(mocks.getConnection).toHaveBeenCalledOnce();
	});
	it("keeps scripture-only manual previews available", async () => {
		mocks.queryOne.mockResolvedValue({
			...row,
			input_json: { ...input, article: null },
		});
		mocks.query.mockResolvedValue(deliveries);
		expect((await prepareBulletin(input.date)).input.article).toBeNull();
		expect(mocks.render).not.toHaveBeenCalled();
	});
	it("rejects an article-free concurrent winner before scheduled delivery", async () => {
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
				{ id: 7, name: "מאמר", author: "מחבר", content: "<p>תוכן</p>" },
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(deliveries);
		await expect(
			prepareBulletin(input.date, { requireArticle: true }),
		).rejects.toThrow("No approved article");
		expect(mocks.render).toHaveBeenCalledWith(input);
		expect(mocks.commit).toHaveBeenCalledOnce();
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
