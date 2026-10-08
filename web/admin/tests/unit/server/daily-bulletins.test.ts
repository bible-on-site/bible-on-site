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
	it("returns the stored winner when another request prepared the date first", async () => {
		const winner = {
			...row,
			input_json: { ...input, article: { ...input.article, id: 42 } },
		};
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 1 })
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
			.mockResolvedValueOnce({ perek_id: 1 });
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
			.mockResolvedValueOnce({ perek_id: 1 });
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
	it("includes chapter dedications in the saved input and reports a missing post-commit snapshot", async () => {
		mocks.queryOne
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ perek_id: 1 })
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
