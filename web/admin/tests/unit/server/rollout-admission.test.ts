import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	ensureSubscribed: vi.fn(),
	unsubscribe: vi.fn(),
	sesDestroy: vi.fn(),
	loadRuntime: vi.fn(),
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("~/server/ses-settings.server", () => ({
	loadEmailRuntime: m.loadRuntime,
}));
vi.mock("~/server/ses-client.server", () => ({
	SesClient: class {
		ensureSubscribedContact = m.ensureSubscribed;
		unsubscribeContact = m.unsubscribe;
		destroy = m.sesDestroy;
	},
}));
vi.mock("~/server/outbox-deadline.server", () => ({
	runOutboxSweep: async (
		_shutdown: AbortSignal | undefined,
		operation: (signal: AbortSignal) => Promise<void>,
	) => operation(new AbortController().signal),
}));
vi.mock("~/server/db", () => ({
	transaction: async (fn: (conn: object) => Promise<unknown>) => fn({}),
	query: async (sql: string, params?: unknown[]) => state.query(sql, params),
	queryOne: async (sql: string, params?: unknown[]) =>
		state.query(sql, params)[0] ?? null,
	execute: async (sql: string, params?: unknown[]) =>
		state.execute(sql, params),
	txQueryOne: async (_conn: object, sql: string, params?: unknown[]) =>
		state.query(sql, params)[0] ?? null,
	txExecute: async (_conn: object, sql: string, params?: unknown[]) =>
		state.execute(sql, params),
}));

interface Subscriber {
	id: number;
	email: string;
	consent_status: string;
	consent_source: string | null;
}
interface CohortRow {
	subscriber_id: number;
	position: number;
	status: string;
	admission_date: string | null;
	excluded_reason: string | null;
}
interface Admission {
	cohort: string;
	local_date: string;
	subscriber_id: number | null;
	status: string;
	last_error: string | null;
}

const runtime = {
	region: "il-central-1",
	fromAddress: "bulletin@example.invalid",
	contactListName: "list",
	configurationSetName: "set",
	senderName: "bulletin",
	queueUrl: "https://sqs.il-central-1.amazonaws.com/123456789012/q",
	accountId: "123456789012",
};

/** In-memory implementation of the exact SQL contract the sweep issues. */
const state = {
	rollout: {
		state: "disabled",
		cohort: "original",
		last_error: null as string | null,
	},
	subscribers: new Map<number, Subscriber>(),
	cohort: new Map<number, CohortRow>(),
	admissions: new Map<string, Admission>(),

	admissionKey(cohort: string, localDate: string) {
		return `${cohort}|${localDate}`;
	},
	query(sql: string, params: unknown[] = []) {
		if (sql.includes("tanah_daily_bulletin_email_rollout"))
			return [{ ...this.rollout }];
		// The next-member select embeds a NOT EXISTS subselect over the
		// admission table, so it must dispatch before the admission patterns.
		if (sql.includes("FROM tanah_daily_bulletin_email_cohort c")) {
			const cohort = String(params[0]);
			const next = [...this.cohort.values()]
				.filter(
					(row) =>
						this.rollout.cohort === cohort &&
						row.status === "pending" &&
						this.subscribers.get(row.subscriber_id)?.consent_status ===
							"pending" &&
						// NOT EXISTS an outstanding reservation for this member.
						![...this.admissions.values()].some(
							(entry) =>
								entry.status === "reserved" &&
								entry.subscriber_id === row.subscriber_id,
						),
				)
				.sort((a, b) => a.position - b.position)[0];
			return next ? [{ subscriber_id: next.subscriber_id }] : [];
		}
		if (sql.includes("tanah_daily_bulletin_email_admission")) {
			if (sql.includes("WHERE status = 'reserved' AND local_date < ?")) {
				const limit = Number(params[1]);
				return [...this.admissions.values()]
					.filter(
						(row) =>
							row.status === "reserved" && row.local_date < String(params[0]),
					)
					.sort((a, b) => a.local_date.localeCompare(b.local_date))
					.slice(0, limit)
					.map((row) => ({ ...row }));
			}
			const row =
				this.admissions.get(
					this.admissionKey(String(params[0]), String(params[1])),
				) ?? null;
			return row ? [{ ...row }] : [];
		}
		if (sql.includes("tanah_daily_bulletin_subscriber")) {
			const row = this.subscribers.get(Number(params[0])) ?? null;
			return row ? [{ ...row }] : [];
		}
		throw new Error(`Unfaked query: ${sql}`);
	},
	execute(sql: string, params: unknown[] = []) {
		if (
			sql.includes("INSERT IGNORE INTO tanah_daily_bulletin_email_admission")
		) {
			const key = this.admissionKey(String(params[0]), String(params[1]));
			if (this.admissions.has(key)) return { affectedRows: 0 };
			this.admissions.set(key, {
				cohort: String(params[0]),
				local_date: String(params[1]),
				subscriber_id: null,
				status: "reserved",
				last_error: null,
			});
			return { affectedRows: 1 };
		}
		if (
			sql.includes("tanah_daily_bulletin_email_cohort c") &&
			sql.includes("s.consent_status = 'confirmed'")
		) {
			let n = 0;
			for (const row of this.cohort.values())
				if (
					row.status === "pending" &&
					this.subscribers.get(row.subscriber_id)?.consent_status ===
						"confirmed"
				) {
					row.status = "admitted";
					n++;
				}
			return { affectedRows: n };
		}
		if (
			sql.includes("tanah_daily_bulletin_email_cohort c") &&
			sql.includes("c.excluded_reason = s.consent_status")
		) {
			let n = 0;
			for (const row of this.cohort.values())
				if (
					row.status === "pending" &&
					this.subscribers.get(row.subscriber_id)?.consent_status !== "pending"
				) {
					row.status = "excluded";
					row.excluded_reason =
						this.subscribers.get(row.subscriber_id)?.consent_status ?? null;
					n++;
				}
			return { affectedRows: n };
		}
		if (sql.includes("SET status = 'exhausted'")) {
			const row = this.admissions.get(
				this.admissionKey(String(params[0]), String(params[1])),
			);
			if (row?.status !== "reserved" || row.subscriber_id !== null)
				return { affectedRows: 0 };
			row.status = "exhausted";
			return { affectedRows: 1 };
		}
		if (sql.includes("SET state = 'completed'")) {
			this.rollout.state = "completed";
			return { affectedRows: 1 };
		}
		if (sql.includes("tanah_daily_bulletin_email_rollout SET last_error")) {
			this.rollout.last_error = String(params[0]);
			return { affectedRows: 1 };
		}
		if (sql.includes("SET subscriber_id = ?, last_error = NULL")) {
			const row = this.admissions.get(
				this.admissionKey(String(params[1]), String(params[2])),
			);
			if (row?.status !== "reserved") return { affectedRows: 0 };
			row.subscriber_id = Number(params[0]);
			row.last_error = null;
			return { affectedRows: 1 };
		}
		if (
			sql.includes("tanah_daily_bulletin_email_cohort SET status = 'excluded'")
		) {
			const row = this.cohort.get(Number(params[2]));
			if (row?.status !== "pending") return { affectedRows: 0 };
			row.status = "excluded";
			row.excluded_reason = String(params[0]);
			return { affectedRows: 1 };
		}
		if (sql.includes("SET subscriber_id = NULL")) {
			const row = this.admissions.get(
				this.admissionKey(String(params[1]), String(params[2])),
			);
			const member = params[3] === null ? null : Number(params[3]);
			if (row?.status !== "reserved" || row.subscriber_id !== member)
				return { affectedRows: 0 };
			row.subscriber_id = null;
			row.last_error = String(params[0]);
			return { affectedRows: 1 };
		}
		if (sql.includes("SET status = 'lapsed'")) {
			const row = this.admissions.get(
				this.admissionKey(String(params[1]), String(params[2])),
			);
			const member = params[3] === null ? null : Number(params[3]);
			if (row?.status !== "reserved" || row.subscriber_id !== member)
				return { affectedRows: 0 };
			row.status = "lapsed";
			row.last_error = String(params[0]);
			return { affectedRows: 1 };
		}
		if (sql.includes("SET consent_status = 'unsubscribed'")) {
			const row = this.subscribers.get(Number(params[0]));
			if (row && ["pending", "confirmed"].includes(row.consent_status)) {
				row.consent_status = "unsubscribed";
				return { affectedRows: 1 };
			}
			return { affectedRows: 0 };
		}
		if (sql.includes("SET consent_status = 'confirmed'")) {
			const row = this.subscribers.get(Number(params[0]));
			if (row?.consent_status !== "pending") return { affectedRows: 0 };
			row.consent_status = "confirmed";
			row.consent_source ??= "Original subscriber list rollout";
			return { affectedRows: 1 };
		}
		if (sql.includes("SET status = 'admitted', admission_date")) {
			const row = this.cohort.get(Number(params[2]));
			if (row?.status !== "pending") return { affectedRows: 0 };
			row.status = "admitted";
			row.admission_date = String(params[0]);
			return { affectedRows: 1 };
		}
		if (sql.includes("SET status = 'admitted', last_error = NULL")) {
			const row = this.admissions.get(
				this.admissionKey(String(params[0]), String(params[1])),
			);
			const member = params[2] === null ? null : Number(params[2]);
			if (row?.status !== "reserved" || row.subscriber_id !== member)
				return { affectedRows: 0 };
			row.status = "admitted";
			row.last_error = null;
			return { affectedRows: 1 };
		}
		if (sql.includes("SET last_error = ?")) {
			const row = this.admissions.get(
				this.admissionKey(String(params[1]), String(params[2])),
			);
			if (row?.status !== "reserved") return { affectedRows: 0 };
			row.last_error = String(params[0]);
			return { affectedRows: 1 };
		}
		throw new Error(`Unfaked statement: ${sql}`);
	},
};

function seed(
	members: { id: number; email: string; consent: string }[],
	rollout = "running",
) {
	state.rollout.state = rollout;
	state.admissions.clear();
	state.cohort.clear();
	state.subscribers.clear();
	members.forEach((entry, index) => {
		state.subscribers.set(entry.id, {
			id: entry.id,
			email: entry.email,
			consent_status: entry.consent,
			consent_source: null,
		});
		state.cohort.set(entry.id, {
			subscriber_id: entry.id,
			position: index + 1,
			status: "pending",
			admission_date: null,
			excluded_reason: null,
		});
	});
}

import { reconcileRolloutAdmission } from "~/server/rollout-admission.server";

const at = (utc: string) => new Date(`${utc}Z`);

beforeEach(() => {
	vi.resetAllMocks();
	state.rollout = { state: "disabled", cohort: "original", last_error: null };
	state.subscribers.clear();
	state.cohort.clear();
	state.admissions.clear();
	m.loadRuntime.mockReturnValue(runtime);
	m.ensureSubscribed.mockResolvedValue("subscribed");
	m.unsubscribe.mockResolvedValue(undefined);
});

describe("original-cohort admission sweep", () => {
	it("does nothing while disabled or the runtime is absent", async () => {
		seed([{ id: 1, email: "a@x.invalid", consent: "pending" }], "disabled");
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		expect(state.admissions.size).toBe(0);
		state.rollout.state = "running";
		m.loadRuntime.mockReturnValue(null);
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		expect(state.admissions.size).toBe(0);
		expect(m.ensureSubscribed).not.toHaveBeenCalled();
	});
	it("admits exactly the first eligible member once per local day", async () => {
		seed([
			{ id: 1, email: "first@x.invalid", consent: "pending" },
			{ id: 2, email: "second@x.invalid", consent: "pending" },
		]);
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		expect(state.subscribers.get(1)?.consent_status).toBe("confirmed");
		// The original list — not the provisioned SES contact — is recorded as
		// the durable consent basis.
		expect(state.subscribers.get(1)?.consent_source).toBe(
			"Original subscriber list rollout",
		);
		expect(state.subscribers.get(2)?.consent_status).toBe("pending");
		expect(state.cohort.get(1)).toMatchObject({
			status: "admitted",
			admission_date: "2026-11-02",
		});
		expect(state.admissions.get("original|2026-11-02")).toMatchObject({
			status: "admitted",
			subscriber_id: 1,
		});
		// Duplicate triggers the same day activate nobody else.
		for (const instant of ["2026-11-02T07:00:00", "2026-11-02T12:00:00"])
			await reconcileRolloutAdmission(undefined, at(instant));
		expect(m.ensureSubscribed).toHaveBeenCalledTimes(1);
		expect(m.ensureSubscribed).toHaveBeenCalledWith("first@x.invalid", "real");
		expect(state.subscribers.get(2)?.consent_status).toBe("pending");
	});
	it("admits the next member on the next Jerusalem day, in cohort order", async () => {
		seed([
			{ id: 1, email: "first@x.invalid", consent: "pending" },
			{ id: 2, email: "second@x.invalid", consent: "pending" },
		]);
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		await reconcileRolloutAdmission(undefined, at("2026-11-03T06:00:00"));
		expect(m.ensureSubscribed.mock.calls.map(([email]) => email)).toEqual([
			"first@x.invalid",
			"second@x.invalid",
		]);
		expect(state.cohort.get(2)).toMatchObject({
			status: "admitted",
			admission_date: "2026-11-03",
		});
	});
	it("skips ineligible members and already-active signups without consuming extra days", async () => {
		seed([
			{ id: 1, email: "gone@x.invalid", consent: "unsubscribed" },
			{ id: 2, email: "direct@x.invalid", consent: "confirmed" },
			{ id: 3, email: "next@x.invalid", consent: "pending" },
		]);
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		expect(state.cohort.get(1)).toMatchObject({
			status: "excluded",
			excluded_reason: "unsubscribed",
		});
		expect(state.cohort.get(2)?.status).toBe("admitted");
		expect(state.cohort.get(3)).toMatchObject({
			status: "admitted",
			admission_date: "2026-11-02",
		});
		// Only the genuinely new admission touched SES.
		expect(m.ensureSubscribed).toHaveBeenCalledTimes(1);
		expect(m.ensureSubscribed).toHaveBeenCalledWith("next@x.invalid", "real");
	});
	it("keeps the same-day reservation after an SES-opted-out candidate and admits the next member", async () => {
		seed([
			{ id: 1, email: "refused@x.invalid", consent: "pending" },
			{ id: 2, email: "kept@x.invalid", consent: "pending" },
		]);
		m.ensureSubscribed.mockImplementation(async (email: string) =>
			email === "refused@x.invalid" ? "opted_out" : "subscribed",
		);
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		expect(state.subscribers.get(1)?.consent_status).toBe("unsubscribed");
		expect(state.cohort.get(1)).toMatchObject({
			status: "excluded",
			excluded_reason: "ses-opted-out",
		});
		expect(state.admissions.get("original|2026-11-02")).toMatchObject({
			status: "admitted",
			subscriber_id: 2,
		});
		expect(state.cohort.get(2)?.status).toBe("admitted");
	});
	it("never re-subscribes a member whose consent lapsed mid-flight", async () => {
		seed([
			{ id: 1, email: "late@x.invalid", consent: "pending" },
			{ id: 2, email: "later@x.invalid", consent: "pending" },
		]);
		m.ensureSubscribed.mockImplementation(async (email: string) => {
			if (email === "late@x.invalid") {
				const member = state.subscribers.get(1);
				if (member) member.consent_status = "unsubscribed";
			}
			return "subscribed";
		});
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		expect(state.subscribers.get(1)?.consent_status).toBe("unsubscribed");
		expect(state.cohort.get(1)).toMatchObject({
			status: "excluded",
			excluded_reason: "late-event",
		});
		expect(m.unsubscribe).toHaveBeenCalledWith("late@x.invalid", "real");
		expect(state.cohort.get(2)?.status).toBe("admitted");
	});
	it("resumes the same recorded subscriber after an uncertain SES outcome", async () => {
		seed([
			{ id: 1, email: "first@x.invalid", consent: "pending" },
			{ id: 2, email: "second@x.invalid", consent: "pending" },
		]);
		m.ensureSubscribed.mockRejectedValueOnce(new Error("timeout"));
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		expect(state.admissions.get("original|2026-11-02")).toMatchObject({
			status: "reserved",
			subscriber_id: 1,
			last_error: "timeout",
		});
		expect(state.subscribers.get(1)?.consent_status).toBe("pending");
		await reconcileRolloutAdmission(undefined, at("2026-11-02T09:00:00"));
		expect(m.ensureSubscribed.mock.calls.map(([email]) => email)).toEqual([
			"first@x.invalid",
			"first@x.invalid",
		]);
		expect(state.cohort.get(1)?.status).toBe("admitted");
		expect(state.subscribers.get(2)?.consent_status).toBe("pending");
	});
	it("finishes an older in-flight reservation for its recorded subscriber, never a substitute", async () => {
		seed([
			{ id: 1, email: "stale@x.invalid", consent: "pending" },
			{ id: 2, email: "fresh@x.invalid", consent: "pending" },
		]);
		state.admissions.set("original|2026-11-01", {
			cohort: "original",
			local_date: "2026-11-01",
			subscriber_id: 1,
			status: "reserved",
			last_error: null,
		});
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		expect(state.admissions.get("original|2026-11-01")?.status).toBe(
			"admitted",
		);
		expect(state.cohort.get(1)).toMatchObject({
			status: "admitted",
			admission_date: "2026-11-01",
		});
		expect(state.cohort.get(2)).toMatchObject({
			status: "admitted",
			admission_date: "2026-11-02",
		});
	});
	it("lapses a stale reservation whose recorded subscriber became ineligible without admitting a substitute", async () => {
		seed([
			{ id: 1, email: "gone@x.invalid", consent: "unsubscribed" },
			{ id: 2, email: "fresh@x.invalid", consent: "pending" },
		]);
		state.admissions.set("original|2026-11-01", {
			cohort: "original",
			local_date: "2026-11-01",
			subscriber_id: 1,
			status: "reserved",
			last_error: null,
		});
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		expect(state.admissions.get("original|2026-11-01")?.status).toBe("lapsed");
		expect(state.cohort.get(2)).toMatchObject({
			status: "admitted",
			admission_date: "2026-11-02",
		});
	});
	it("never catches up missed days: a quiet weekend adds no bulk admissions", async () => {
		seed([
			{ id: 1, email: "a@x.invalid", consent: "pending" },
			{ id: 2, email: "b@x.invalid", consent: "pending" },
			{ id: 3, email: "c@x.invalid", consent: "pending" },
		]);
		// The worker was down Friday through Sunday; Monday resumes with one.
		await reconcileRolloutAdmission(undefined, at("2026-11-09T06:00:00"));
		expect(
			[...state.cohort.values()].filter((r) => r.status === "admitted"),
		).toHaveLength(1);
		expect(state.admissions.size).toBe(1);
	});
	it("completes the rollout when the eligible cohort is exhausted", async () => {
		seed([{ id: 1, email: "only@x.invalid", consent: "unsubscribed" }]);
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		expect(state.admissions.get("original|2026-11-02")?.status).toBe(
			"exhausted",
		);
		expect(state.rollout.state).toBe("completed");
	});
	it("records completion without new work once exhausted", async () => {
		seed([{ id: 1, email: "a@x.invalid", consent: "pending" }]);
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		await reconcileRolloutAdmission(undefined, at("2026-11-03T06:00:00"));
		expect(state.rollout.state).toBe("completed");
		expect(state.admissions.get("original|2026-11-03")?.status).toBe(
			"exhausted",
		);
		expect(m.ensureSubscribed).toHaveBeenCalledTimes(1);
	});
	it("freezes stale reservations without provider calls while paused or disabled", async () => {
		seed([
			{ id: 1, email: "held@x.invalid", consent: "pending" },
			{ id: 2, email: "next@x.invalid", consent: "pending" },
		]);
		state.admissions.set("original|2026-11-01", {
			cohort: "original",
			local_date: "2026-11-01",
			subscriber_id: 1,
			status: "reserved",
			last_error: null,
		});
		for (const stopped of ["paused", "disabled"]) {
			state.rollout.state = stopped;
			await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
			expect(state.subscribers.get(1)?.consent_status).toBe("pending");
			expect(state.admissions.get("original|2026-11-01")).toMatchObject({
				status: "reserved",
				subscriber_id: 1,
			});
		}
		expect(m.ensureSubscribed).not.toHaveBeenCalled();
		// Re-enabling resumes the same recorded member under its own date.
		state.rollout.state = "running";
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		expect(state.admissions.get("original|2026-11-01")?.status).toBe(
			"admitted",
		);
		expect(state.cohort.get(1)?.admission_date).toBe("2026-11-01");
	});
	it("blocks the activation commit when the rollout is disabled mid-check", async () => {
		seed([
			{ id: 1, email: "held@x.invalid", consent: "pending" },
			{ id: 2, email: "next@x.invalid", consent: "pending" },
		]);
		m.ensureSubscribed.mockImplementation(async (email: string) => {
			if (email === "held@x.invalid") state.rollout.state = "disabled";
			return "subscribed";
		});
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		expect(state.subscribers.get(1)?.consent_status).toBe("pending");
		expect(state.cohort.get(1)?.status).toBe("pending");
		expect(state.admissions.get("original|2026-11-02")).toMatchObject({
			status: "reserved",
			subscriber_id: 1,
		});
		expect(state.subscribers.get(2)?.consent_status).toBe("pending");
	});
	it("selects the next member today while an older reservation still holds the first", async () => {
		seed([
			{ id: 1, email: "retry@x.invalid", consent: "pending" },
			{ id: 2, email: "next@x.invalid", consent: "pending" },
		]);
		state.admissions.set("original|2026-11-01", {
			cohort: "original",
			local_date: "2026-11-01",
			subscriber_id: 1,
			status: "reserved",
			last_error: null,
		});
		m.ensureSubscribed.mockImplementation(async (email: string) => {
			if (email === "retry@x.invalid") throw new Error("timeout");
			return "subscribed";
		});
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		// The older reservation keeps its member; today's slot went to member 2.
		expect(state.admissions.get("original|2026-11-01")).toMatchObject({
			status: "reserved",
			subscriber_id: 1,
			last_error: "timeout",
		});
		expect(state.admissions.get("original|2026-11-02")).toMatchObject({
			status: "admitted",
			subscriber_id: 2,
		});
		expect(state.cohort.get(1)?.status).toBe("pending");
	});
	it("bounds same-day re-selection so an all-ineligible day still converges", async () => {
		seed(
			Array.from({ length: 8 }, (_, i) => ({
				id: i + 1,
				email: `s${i + 1}@x.invalid`,
				consent: "pending",
			})),
		);
		m.ensureSubscribed.mockResolvedValue("opted_out");
		await reconcileRolloutAdmission(undefined, at("2026-11-02T06:00:00"));
		// Each ineligible candidate consumes a bounded re-selection; the sweep
		// resumes on the next pass rather than looping unboundedly.
		expect(m.ensureSubscribed.mock.calls.length).toBeLessThanOrEqual(5);
		const remaining = [...state.cohort.values()].filter(
			(row) => row.status === "pending",
		).length;
		expect(remaining).toBeGreaterThan(0);
	});
});
