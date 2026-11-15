import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	execute: vi.fn(),
	transaction: vi.fn(),
	txQuery: vi.fn(),
	txQueryOne: vi.fn(),
	txExecute: vi.fn(),
}));
vi.mock("~/server/db", () => mocks);

import {
	readJoinLinkAudit,
	readJoinLinks,
	updateJoinLink,
} from "~/server/join-links.server";

const connection = {};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.query.mockResolvedValue([]);
	mocks.execute.mockResolvedValue({ affectedRows: 1 });
	mocks.txExecute.mockResolvedValue({ affectedRows: 1 });
	mocks.transaction.mockImplementation(async (fn) => fn(connection));
});

describe("readJoinLinks", () => {
	it("returns every channel in canonical order, synthesizing missing rows", async () => {
		expect(await readJoinLinks()).toEqual([
			{
				channel: "telegram",
				enabled: false,
				destination: null,
				revision: 0,
				updatedBy: null,
				updatedAt: null,
			},
			{
				channel: "whatsapp",
				enabled: false,
				destination: null,
				revision: 0,
				updatedBy: null,
				updatedAt: null,
			},
		]);
	});

	it("maps persisted rows and keeps channels without one disabled", async () => {
		mocks.query.mockResolvedValue([
			{
				channel: "telegram",
				enabled: 1,
				destination: "https://t.me/alhaperek",
				revision: "4",
				updated_by: "editor@example.com",
				updated_at: new Date("2026-10-28T08:00:00.000Z"),
			},
		]);
		expect(await readJoinLinks()).toEqual([
			{
				channel: "telegram",
				enabled: true,
				destination: "https://t.me/alhaperek",
				revision: 4,
				updatedBy: "editor@example.com",
				updatedAt: "2026-10-28T08:00:00.000Z",
			},
			{
				channel: "whatsapp",
				enabled: false,
				destination: null,
				revision: 0,
				updatedBy: null,
				updatedAt: null,
			},
		]);
	});
});

describe("readJoinLinkAudit", () => {
	it("reads newest-first audit rows for all channels", async () => {
		mocks.query.mockResolvedValue([
			{
				id: "9",
				channel: "whatsapp",
				enabled: 0,
				destination: null,
				revision: "2",
				changed_by: "editor@example.com",
				changed_at: "2026-10-28 08:00:00.000",
			},
		]);
		const entries = await readJoinLinkAudit();
		expect(mocks.query.mock.calls[0][1]).toEqual([20]);
		expect(entries).toEqual([
			{
				id: 9,
				channel: "whatsapp",
				enabled: false,
				destination: null,
				revision: 2,
				changedBy: "editor@example.com",
				changedAt: "2026-10-28 08:00:00.000",
			},
		]);
	});

	it("filters the audit by channel when asked", async () => {
		await readJoinLinkAudit("telegram", 5);
		expect(mocks.query.mock.calls[0][0]).toContain("WHERE channel = ?");
		expect(mocks.query.mock.calls[0][1]).toEqual(["telegram", 5]);
	});

	it("keeps an absent audit timestamp empty", async () => {
		mocks.query.mockResolvedValue([
			{
				id: 10,
				channel: "telegram",
				enabled: false,
				destination: null,
				revision: 1,
				changed_by: null,
				changed_at: "",
			},
		]);
		expect(await readJoinLinkAudit()).toEqual([
			expect.objectContaining({ changedAt: "", changedBy: null }),
		]);
	});
});

describe("updateJoinLink", () => {
	const change = {
		channel: "telegram" as const,
		enabled: true,
		destination: "https://t.me/alhaperek",
		expectedRevision: 2,
		changedBy: "editor@example.com",
	};

	it("re-validates the stored destination before writing", async () => {
		await expect(
			updateJoinLink({ ...change, destination: "https://evil.example/x" }),
		).rejects.toThrow("כתובת ההצטרפות אינה תקינה");
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("locks the row, bumps the revision and appends the audit entry", async () => {
		mocks.txQueryOne.mockResolvedValue({
			channel: "telegram",
			enabled: 1,
			destination: "https://t.me/old",
			revision: 2,
			updated_by: "other@example.com",
			updated_at: null,
		});
		const state = await updateJoinLink(change);
		expect(state).toMatchObject({
			channel: "telegram",
			enabled: true,
			destination: "https://t.me/alhaperek",
			revision: 3,
			updatedBy: "editor@example.com",
		});
		expect(mocks.txQueryOne.mock.calls[0][1]).toContain("FOR UPDATE");
		const [, updateSql, updateParams] = mocks.txExecute.mock.calls[0];
		expect(updateSql).toContain("UPDATE tanah_daily_bulletin_join_link");
		expect(updateParams).toEqual([
			true,
			"https://t.me/alhaperek",
			3,
			"editor@example.com",
			"telegram",
		]);
		const [, auditSql, auditParams] = mocks.txExecute.mock.calls[1];
		expect(auditSql).toContain(
			"INSERT INTO tanah_daily_bulletin_join_link_audit",
		);
		expect(auditParams).toEqual([
			"telegram",
			true,
			"https://t.me/alhaperek",
			3,
			"editor@example.com",
		]);
	});

	it("inserts a new row when the channel has none yet", async () => {
		mocks.txQueryOne.mockResolvedValue(null);
		const state = await updateJoinLink({ ...change, expectedRevision: 0 });
		expect(state.revision).toBe(1);
		expect(mocks.txExecute.mock.calls[0][1]).toContain(
			"INSERT INTO tanah_daily_bulletin_join_link",
		);
	});

	it("records a disabled channel with no destination in both state and audit", async () => {
		mocks.txQueryOne.mockResolvedValue(null);
		const state = await updateJoinLink({
			...change,
			enabled: false,
			destination: null,
			expectedRevision: 0,
		});
		expect(state).toMatchObject({
			enabled: false,
			destination: null,
			revision: 1,
		});
		expect(mocks.txExecute.mock.calls[0][2]).toEqual([
			"telegram",
			false,
			null,
			1,
			"editor@example.com",
		]);
		expect(mocks.txExecute.mock.calls[1][2]).toEqual([
			"telegram",
			false,
			null,
			1,
			"editor@example.com",
		]);
	});

	it("fails the compare-and-swap on a stale revision", async () => {
		mocks.txQueryOne.mockResolvedValue({
			channel: "telegram",
			enabled: 1,
			destination: "https://t.me/newer",
			revision: 5,
			updated_by: "other@example.com",
			updated_at: null,
		});
		await expect(updateJoinLink(change)).rejects.toThrow(
			/השתנה על ידי עורך אחר/,
		);
		expect(mocks.txExecute).not.toHaveBeenCalled();
	});
});
