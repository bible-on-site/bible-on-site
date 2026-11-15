import { describe, expect, it } from "vitest";
import {
	bulletinCohortSql,
	type CohortSnapshotMember,
	planBulletinCohort,
} from "~/server/bulletin-rollout-plan";

const member = (
	subscriberId: number,
	consentStatus = "pending",
	email = `legacy${subscriberId}@example.invalid`,
): CohortSnapshotMember => ({ subscriberId, email, consentStatus });

describe("original cohort plan", () => {
	it("preserves the authoritative order as positions and maps consent to cohort status", () => {
		const members = [
			member(7),
			member(3),
			member(9, "confirmed"),
			member(5, "unsubscribed"),
			member(8, "bounced"),
			member(2, "complained"),
		];
		const plan = planBulletinCohort(members);
		expect(plan).toMatchObject({
			total: 6,
			pending: 2,
			admitted: 1,
			excluded: 3,
		});
		expect(plan.rows).toEqual([
			{ subscriberId: 7, position: 1, status: "pending", excludedReason: null },
			{ subscriberId: 3, position: 2, status: "pending", excludedReason: null },
			{
				subscriberId: 9,
				position: 3,
				status: "admitted",
				excludedReason: null,
			},
			{
				subscriberId: 5,
				position: 4,
				status: "excluded",
				excludedReason: "unsubscribed",
			},
			{
				subscriberId: 8,
				position: 5,
				status: "excluded",
				excludedReason: "bounced",
			},
			{
				subscriberId: 2,
				position: 6,
				status: "excluded",
				excludedReason: "complained",
			},
		]);
	});
	it.each([
		{},
		{ subscriberId: 0, email: "a@b.co", consentStatus: "pending" },
		{ subscriberId: -2, email: "a@b.co", consentStatus: "pending" },
		{ subscriberId: 1.5, email: "a@b.co", consentStatus: "pending" },
		{ subscriberId: "7", email: "a@b.co", consentStatus: "pending" },
		{ subscriberId: 1, email: "not-an-email", consentStatus: "pending" },
		{ subscriberId: 1, email: "a@b.co", consentStatus: "active" },
		{ subscriberId: 1, email: 3, consentStatus: "pending" },
	])("rejects malformed snapshot member %j", (entry) => {
		expect(() => planBulletinCohort([entry as CohortSnapshotMember])).toThrow(
			"Invalid original cohort snapshot",
		);
	});
	it("rejects duplicate subscriber IDs and duplicate addresses", () => {
		expect(() =>
			planBulletinCohort([member(4), member(4, "confirmed")]),
		).toThrow("Invalid original cohort snapshot");
		expect(() =>
			planBulletinCohort([
				member(4, "pending", "same@example.invalid"),
				member(9, "pending", "SAME@example.invalid"),
			]),
		).toThrow("Invalid original cohort snapshot");
	});
	it("rejects an empty snapshot", () => {
		expect(() => planBulletinCohort([])).toThrow(
			"Empty original cohort snapshot",
		);
	});
});

describe("cohort enrollment SQL", () => {
	it("guards consent, audience, email and position, then inserts the full cohort transactionally", () => {
		const members = [
			member(7),
			member(3, "confirmed", "quote'o@example.invalid"),
			member(5, "unsubscribed"),
		];
		const plan = planBulletinCohort(members);
		const sql = bulletinCohortSql(members, plan);
		expect(sql).toContain("START TRANSACTION");
		expect(sql).toContain("COMMIT");
		expect(sql).toContain(
			"INSERT INTO bulletin_cohort_guard SELECT IF(COUNT(*)=3,1,0)",
		);
		expect(sql).toContain("s.audience = 'real'");
		expect(sql).toContain("s.consent_status = p.consent_status");
		expect(sql).toContain("LOWER(s.email) = p.email");
		expect(sql).toContain("FOR UPDATE");
		expect(sql).toContain("c.position = p.position AND c.status = p.status");
		expect(sql).toContain(
			"(7,1,'pending',NULL,'legacy7@example.invalid','pending')",
		);
		expect(sql).toContain(
			"(3,2,'admitted',NULL,'quote''o@example.invalid','confirmed')",
		);
		expect(sql).toContain(
			"(5,3,'excluded','unsubscribed','legacy5@example.invalid','unsubscribed')",
		);
		expect(sql).toContain("INSERT INTO tanah_daily_bulletin_email_cohort");
	});
	it("rejects a plan that no longer matches the snapshot", () => {
		const members = [member(1), member(2)];
		const plan = planBulletinCohort(members);
		const shifted = {
			...plan,
			rows: plan.rows.map((row, index) => ({
				...row,
				position: index + 2,
			})),
		};
		expect(() => bulletinCohortSql(members, shifted)).toThrow(
			"Invalid cohort plan",
		);
		expect(() => bulletinCohortSql(members.slice(0, 1), plan)).toThrow(
			"Invalid cohort plan",
		);
	});
});
